#!/usr/bin/env node

/**
 * opengig MCP Server
 * Provides freelance marketplace tools to Claude Code
 */

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  getSupabase,
  getCurrentUser,
  isConfigured,
  ensureConfigDir,
  isAuthenticated,
  getSession,
} from './lib/supabase.js';
import type { Listing, User, Message } from './types.js';

const server = new McpServer({
  name: 'opengig',
  version: '0.2.0',
});

// ============================================
// TOOL: auth_status
// ============================================
server.tool(
  'auth_status',
  'Check current authentication status and user profile',
  {},
  async () => {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              authenticated: false,
              message: 'Not logged in. User needs to authenticate with LinkedIn.',
              action_needed: 'Direct user to run: npx opengig auth (in a separate terminal)',
            }),
          },
        ],
      };
    }

    const session = await getSession();
    const user = await getCurrentUser();

    // If user doesn't exist in our users table yet, return auth info
    if (!user && session) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              authenticated: true,
              user: {
                id: session.user.id,
                name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || 'User',
                email: session.user.email,
                email_verified: session.user.user_metadata?.email_verified,
              },
              note: 'User profile not yet synced to database',
            }),
          },
        ],
      };
    }

    if (!user) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              authenticated: false,
              message: 'Session expired. User needs to re-authenticate.',
              action_needed: 'Direct user to run: npx opengig auth (in a separate terminal)',
            }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            authenticated: true,
            user: {
              id: user.id,
              name: user.name,
              headline: user.headline,
              linkedin_url: user.linkedin_url,
              email: user.email,
              email_verified: user.email_verified,
              phone: user.phone,
            },
          }),
        },
      ],
    };
  }
);

// ============================================
// TOOL: create_listing
// ============================================
server.tool(
  'create_listing',
  'Create a job posting or availability listing',
  {
    type: z.enum(['job', 'available']).describe('Type: "job" if hiring, "available" if looking for work'),
    title: z.string().describe('Title of the listing (e.g., "Senior React Developer" or "Looking for Frontend Work")'),
    description: z.string().describe('Detailed description of the role or your experience'),
    skills: z.array(z.string()).describe('Array of relevant skills (e.g., ["react", "typescript", "node"])'),
    rate_min: z.number().optional().describe('Minimum rate in USD'),
    rate_max: z.number().optional().describe('Maximum rate in USD'),
    rate_type: z.enum(['hourly', 'fixed', 'negotiable']).optional().describe('How the rate is structured'),
    remote: z.boolean().default(true).describe('Whether remote work is accepted'),
    location: z.string().optional().describe('Location if not fully remote'),
  },
  async (params) => {
    const user = await getCurrentUser();
    if (!user) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated. User needs to login first.' }) }],
      };
    }

    try {
      const db = getSupabase();
      const listing: Partial<Listing> = {
        user_id: user.id,
        type: params.type,
        title: params.title,
        description: params.description,
        skills: params.skills.map((s) => s.toLowerCase()),
        rate_min: params.rate_min,
        rate_max: params.rate_max,
        rate_type: params.rate_type,
        remote: params.remote,
        location: params.location,
        active: true,
      };

      const { data, error } = await db.from('listings').insert(listing).select().single();
      if (error) throw error;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              listing_id: data.id,
              message: `${params.type === 'job' ? 'Job' : 'Availability'} listing created successfully!`,
              listing: data,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Failed to create listing: ${error}` }) }],
      };
    }
  }
);

// ============================================
// TOOL: search_listings
// ============================================
server.tool(
  'search_listings',
  'Search for jobs or available freelancers using natural language',
  {
    query: z.string().describe('Natural language search query (e.g., "react developer who knows AWS")'),
    type: z.enum(['jobs', 'talent']).describe('Search for "jobs" (to find work) or "talent" (to hire)'),
    skills_filter: z.array(z.string()).optional().describe('Optional: filter by specific skills'),
    rate_max: z.number().optional().describe('Optional: maximum rate to filter by'),
    remote_only: z.boolean().optional().describe('Optional: only show remote positions'),
  },
  async (params) => {
    const user = await getCurrentUser();
    if (!user) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }],
      };
    }

    try {
      const db = getSupabase();
      const listingType = params.type === 'jobs' ? 'job' : 'available';

      let query = db
        .from('listings')
        .select(
          `
          *,
          user:users (id, name, headline, linkedin_url)
        `
        )
        .eq('type', listingType)
        .eq('active', true)
        .neq('user_id', user.id);

      if (params.remote_only) {
        query = query.eq('remote', true);
      }

      if (params.rate_max) {
        query = query.lte('rate_min', params.rate_max);
      }

      if (params.skills_filter && params.skills_filter.length > 0) {
        query = query.overlaps('skills', params.skills_filter.map((s) => s.toLowerCase()));
      }

      const { data: listings, error } = await query.limit(20);
      if (error) throw error;

      if (!listings || listings.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                results: [],
                message: 'No matches found. Try broadening your search or check back later.',
              }),
            },
          ],
        };
      }

      // Score and rank results based on query
      const scoredResults = scoreListings(listings, params.query);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              results: scoredResults,
              total: scoredResults.length,
              search_type: params.type,
              query: params.query,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Search failed: ${error}` }) }],
      };
    }
  }
);

// Simple scoring function (Claude will do the real analysis)
function scoreListings(
  listings: (Listing & { user: User })[],
  query: string
): Array<{ listing: Listing; user: User; relevance_hints: string[] }> {
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  return listings.map((item) => {
    const hints: string[] = [];
    const searchText = `${item.title} ${item.description} ${item.skills.join(' ')}`.toLowerCase();

    queryWords.forEach((word) => {
      if (searchText.includes(word)) {
        hints.push(`Matches "${word}"`);
      }
    });

    item.skills.forEach((skill) => {
      if (queryWords.some((w) => skill.includes(w) || w.includes(skill))) {
        hints.push(`Has skill: ${skill}`);
      }
    });

    return {
      listing: {
        id: item.id,
        type: item.type,
        title: item.title,
        description: item.description,
        skills: item.skills,
        rate_min: item.rate_min,
        rate_max: item.rate_max,
        rate_type: item.rate_type,
        remote: item.remote,
        location: item.location,
        created_at: item.created_at,
      } as Listing,
      user: item.user,
      relevance_hints: hints,
    };
  });
}

// ============================================
// TOOL: get_conversations
// ============================================
server.tool('get_conversations', 'Get all conversations for the current user', {}, async () => {
  const user = await getCurrentUser();
  if (!user) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }],
    };
  }

  try {
    const db = getSupabase();

    const { data: conversations, error } = await db
      .from('conversations')
      .select(
        `
        *,
        messages (id, content, sender_id, read, created_at)
      `
      )
      .contains('participant_ids', [user.id])
      .order('last_message_at', { ascending: false });

    if (error) throw error;

    if (!conversations || conversations.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              conversations: [],
              message: 'No conversations yet. Start by searching for opportunities and messaging someone!',
            }),
          },
        ],
      };
    }

    // Get other users' info
    const otherUserIds = conversations.flatMap((c) =>
      c.participant_ids.filter((id: string) => id !== user.id)
    );

    const { data: users } = await db.from('users').select('id, name, headline').in('id', otherUserIds);
    const userMap = new Map((users || []).map((u) => [u.id, u]));

    const enriched = conversations.map((conv) => {
      const otherUserId = conv.participant_ids.find((id: string) => id !== user.id);
      const otherUser = userMap.get(otherUserId);
      const messages = conv.messages || [];
      const unreadCount = messages.filter((m: Message) => m.sender_id !== user.id && !m.read).length;
      const lastMessage = messages.sort(
        (a: Message, b: Message) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];

      return {
        id: conv.id,
        other_user: otherUser || { id: otherUserId, name: 'Unknown' },
        unread_count: unreadCount,
        last_message: lastMessage
          ? {
              preview: lastMessage.content.substring(0, 100),
              sent_by_me: lastMessage.sender_id === user.id,
              timestamp: lastMessage.created_at,
            }
          : null,
      };
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({ conversations: enriched }) }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Failed to get conversations: ${error}` }) }],
    };
  }
});

// ============================================
// TOOL: send_message
// ============================================
server.tool(
  'send_message',
  'Send a message to another user',
  {
    recipient_id: z.string().describe('User ID of the recipient'),
    message: z.string().describe('Message content'),
    listing_id: z.string().optional().describe('Optional: ID of the listing this conversation is about'),
  },
  async (params) => {
    const user = await getCurrentUser();
    if (!user) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }],
      };
    }

    try {
      const db = getSupabase();

      // Get or create conversation
      const participantIds = [user.id, params.recipient_id].sort();

      let conversation;
      const { data: existingConv } = await db
        .from('conversations')
        .select('*')
        .contains('participant_ids', participantIds)
        .single();

      if (existingConv) {
        conversation = existingConv;
      } else {
        const { data: newConv, error: convError } = await db
          .from('conversations')
          .insert({
            participant_ids: participantIds,
            listing_id: params.listing_id,
            last_message_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (convError) throw convError;
        conversation = newConv;
      }

      // Send message
      const { error: msgError } = await db.from('messages').insert({
        conversation_id: conversation.id,
        sender_id: user.id,
        recipient_id: params.recipient_id,
        content: params.message,
        read: false,
      });

      if (msgError) throw msgError;

      // Update conversation timestamp
      await db
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversation.id);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Message sent successfully!',
              conversation_id: conversation.id,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Failed to send message: ${error}` }) }],
      };
    }
  }
);

// ============================================
// TOOL: get_messages
// ============================================
server.tool(
  'get_messages',
  'Get messages from a specific conversation',
  {
    conversation_id: z.string().describe('ID of the conversation'),
    mark_as_read: z.boolean().default(true).describe('Mark messages as read'),
  },
  async (params) => {
    const user = await getCurrentUser();
    if (!user) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }],
      };
    }

    try {
      const db = getSupabase();

      const { data: messages, error } = await db
        .from('messages')
        .select('*')
        .eq('conversation_id', params.conversation_id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Mark as read if requested
      if (params.mark_as_read) {
        await db
          .from('messages')
          .update({ read: true })
          .eq('conversation_id', params.conversation_id)
          .neq('sender_id', user.id);
      }

      const formatted = (messages || []).map((msg: Message) => ({
        id: msg.id,
        content: msg.content,
        sent_by_me: msg.sender_id === user.id,
        timestamp: msg.created_at,
        read: msg.read,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({ messages: formatted }) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Failed to get messages: ${error}` }) }],
      };
    }
  }
);

// ============================================
// TOOL: share_contact
// ============================================
server.tool(
  'share_contact',
  'Share contact information with another user',
  {
    recipient_id: z.string().describe('User ID to share contact info with'),
    include_email: z.boolean().default(true).describe('Include email address'),
    include_phone: z.boolean().default(false).describe('Include phone number'),
    include_linkedin: z.boolean().default(true).describe('Include LinkedIn URL'),
    message: z.string().optional().describe('Optional personal message'),
  },
  async (params) => {
    const user = await getCurrentUser();
    if (!user) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }],
      };
    }

    try {
      const db = getSupabase();

      const shareData = {
        sharer_id: user.id,
        recipient_id: params.recipient_id,
        email: params.include_email ? user.email : null,
        phone: params.include_phone ? user.phone : null,
        linkedin_url: params.include_linkedin ? user.linkedin_url : null,
        message: params.message,
      };

      const { error } = await db.from('contact_shares').insert(shareData);
      if (error) throw error;

      // Also send a message notification
      const { data: conversation } = await db
        .from('conversations')
        .select('id')
        .contains('participant_ids', [user.id, params.recipient_id])
        .single();

      if (conversation) {
        let notificationContent = `📧 I'm sharing my contact info with you:\n`;
        if (params.include_linkedin) notificationContent += `\nLinkedIn: ${user.linkedin_url}`;
        if (params.include_email && user.email) notificationContent += `\nEmail: ${user.email}`;
        if (params.include_phone && user.phone) notificationContent += `\nPhone: ${user.phone}`;
        if (params.message) notificationContent += `\n\n"${params.message}"`;

        await db.from('messages').insert({
          conversation_id: conversation.id,
          sender_id: user.id,
          recipient_id: params.recipient_id,
          content: notificationContent,
          read: false,
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Contact information shared!',
              shared: {
                email: params.include_email && user.email,
                phone: params.include_phone && user.phone,
                linkedin: params.include_linkedin,
              },
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Failed to share contact: ${error}` }) }],
      };
    }
  }
);

// ============================================
// TOOL: get_my_listings
// ============================================
server.tool('get_my_listings', 'Get current user\'s active listings', {}, async () => {
  const user = await getCurrentUser();
  if (!user) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }],
    };
  }

  try {
    const db = getSupabase();

    const { data: listings, error } = await db
      .from('listings')
      .select('*')
      .eq('user_id', user.id)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            listings: listings || [],
            count: listings?.length || 0,
          }),
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Failed to get listings: ${error}` }) }],
    };
  }
});

// ============================================
// TOOL: deactivate_listing
// ============================================
server.tool(
  'deactivate_listing',
  'Deactivate/remove one of your listings',
  {
    listing_id: z.string().describe('ID of the listing to deactivate'),
  },
  async (params) => {
    const user = await getCurrentUser();
    if (!user) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }],
      };
    }

    try {
      const db = getSupabase();

      const { error } = await db
        .from('listings')
        .update({ active: false })
        .eq('id', params.listing_id)
        .eq('user_id', user.id);

      if (error) throw error;

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Listing deactivated' }) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Failed to deactivate: ${error}` }) }],
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('opengig MCP server running');
}

main().catch(console.error);
