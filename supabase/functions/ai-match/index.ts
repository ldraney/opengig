// AI-powered matching for opengig
// Uses Claude to analyze queries and rank matches

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

interface MatchRequest {
  query: string;
  type: 'jobs' | 'talent';
  userId: string;
}

interface Listing {
  id: string;
  user_id: string;
  type: string;
  title: string;
  description: string;
  skills: string[];
  rate_min?: number;
  rate_max?: number;
  rate_type?: string;
  remote: boolean;
  location?: string;
}

interface User {
  id: string;
  name: string;
  headline?: string;
  linkedin_url: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const { query, type, userId }: MatchRequest = await req.json();

    if (!query || !type || !userId) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Get the searching user's profile for context
    const { data: searchingUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    // Get relevant listings based on search type
    const listingType = type === 'jobs' ? 'job' : 'available';

    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select(`
        *,
        user:users (id, name, headline, linkedin_url)
      `)
      .eq('type', listingType)
      .eq('active', true)
      .neq('user_id', userId) // Don't show own listings
      .limit(50);

    if (listingsError) {
      console.error('Listings error:', listingsError);
      return new Response(JSON.stringify({ error: 'Failed to fetch listings' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!listings || listings.length === 0) {
      return new Response(
        JSON.stringify({
          matches: [],
          message: 'No listings found',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Use AI to rank and explain matches
    const matches = await rankWithAI(query, listings, searchingUser, type);

    return new Response(
      JSON.stringify({ matches }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Match error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

async function rankWithAI(
  query: string,
  listings: (Listing & { user: User })[],
  searchingUser: User | null,
  searchType: 'jobs' | 'talent'
): Promise<Array<{ listing: Listing; user: User; score: number; reasons: string[] }>> {
  // If no API key, fall back to keyword matching
  if (!ANTHROPIC_API_KEY) {
    return keywordMatch(query, listings);
  }

  try {
    const listingsContext = listings.map((l, i) => ({
      index: i,
      title: l.title,
      description: l.description.substring(0, 500),
      skills: l.skills,
      rate: l.rate_min && l.rate_max ? `$${l.rate_min}-${l.rate_max}` : 'negotiable',
      remote: l.remote,
      location: l.location,
      poster: l.user.name,
      headline: l.user.headline,
    }));

    const prompt = `You are a job matching assistant for opengig, a freelance marketplace.

A user is searching for ${searchType === 'jobs' ? 'job opportunities' : 'freelancers to hire'}.

User's search query: "${query}"
${searchingUser?.headline ? `User's headline: ${searchingUser.headline}` : ''}

Here are the available ${searchType === 'jobs' ? 'job listings' : 'freelancers'}:

${JSON.stringify(listingsContext, null, 2)}

Analyze each listing and rank them by relevance to the user's search query. Consider:
- Skill match
- Rate alignment (if mentioned)
- Remote/location preferences
- Experience level signals
- Description relevance

Return a JSON array of matches with this structure:
{
  "matches": [
    {
      "index": <listing index>,
      "score": <0.0 to 1.0>,
      "reasons": ["reason 1", "reason 2"]
    }
  ]
}

Only include listings with score > 0.3. Sort by score descending. Limit to top 10.
Return ONLY the JSON, no other text.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('Claude API error:', await response.text());
      return keywordMatch(query, listings);
    }

    const result = await response.json();
    const content = result.content[0]?.text || '{"matches":[]}';

    // Parse AI response
    const parsed = JSON.parse(content);
    const aiMatches = parsed.matches || [];

    // Map back to full listing objects
    return aiMatches.map((m: { index: number; score: number; reasons: string[] }) => ({
      listing: {
        id: listings[m.index].id,
        user_id: listings[m.index].user_id,
        type: listings[m.index].type,
        title: listings[m.index].title,
        description: listings[m.index].description,
        skills: listings[m.index].skills,
        rate_min: listings[m.index].rate_min,
        rate_max: listings[m.index].rate_max,
        rate_type: listings[m.index].rate_type,
        remote: listings[m.index].remote,
        location: listings[m.index].location,
      },
      user: listings[m.index].user,
      score: m.score,
      reasons: m.reasons,
    }));
  } catch (error) {
    console.error('AI ranking error:', error);
    return keywordMatch(query, listings);
  }
}

// Fallback: simple keyword matching when AI is not available
function keywordMatch(
  query: string,
  listings: (Listing & { user: User })[]
): Array<{ listing: Listing; user: User; score: number; reasons: string[] }> {
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  const scored = listings.map((listing) => {
    const searchText = `${listing.title} ${listing.description} ${listing.skills.join(' ')}`.toLowerCase();

    let score = 0;
    const matchedWords: string[] = [];

    queryWords.forEach((word) => {
      if (searchText.includes(word)) {
        score += 0.2;
        matchedWords.push(word);
      }
    });

    // Skill exact matches are worth more
    listing.skills.forEach((skill) => {
      if (queryWords.includes(skill.toLowerCase())) {
        score += 0.3;
      }
    });

    // Cap at 1.0
    score = Math.min(score, 1.0);

    return {
      listing: {
        id: listing.id,
        user_id: listing.user_id,
        type: listing.type,
        title: listing.title,
        description: listing.description,
        skills: listing.skills,
        rate_min: listing.rate_min,
        rate_max: listing.rate_max,
        rate_type: listing.rate_type,
        remote: listing.remote,
        location: listing.location,
      },
      user: listing.user,
      score,
      reasons: matchedWords.length > 0 ? [`Matches: ${matchedWords.join(', ')}`] : [],
    };
  });

  return scored
    .filter((m) => m.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}
