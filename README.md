# opengig

Free, open freelance marketplace. Terminal-native. AI-assisted. No fees ever.

## What is this?

opengig is a CLI that launches [Claude Code](https://claude.ai/code) with marketplace superpowers. Instead of building yet another web UI, we use AI as the interface:

```
You: "I'm looking for React work, remote, around $80/hr"

Claude: Found 5 matching jobs! Here are the top matches:

1. Senior React Developer at TechCorp
   - $70-90/hr, fully remote
   - Looking for: React, TypeScript, Node

Want me to help you reach out?
```

## How it works

```
npx opengig
    ↓
Launches Claude Code with MCP tools for:
    - Searching jobs/talent
    - Posting listings
    - Messaging
    - Sharing contact info
    ↓
You talk naturally, Claude handles the rest
```

## Quick Start

```bash
# 1. Authenticate with LinkedIn
npx opengig auth

# 2. Start the marketplace
npx opengig

# 3. Talk to Claude
"I'm available for Python/Django work, $100/hr"
"Find me someone who knows AWS and Terraform"
"Check my messages"
```

## Why?

| Platform | Take Rate | UX |
|----------|-----------|-----|
| Upwork | 10-20% | Web forms |
| Fiverr | 20% | Web forms |
| LinkedIn | Expensive | Bloated |
| **opengig** | **0%** | **Conversation** |

We just connect people. Payment happens between you.

## Trust Model

- LinkedIn OAuth required (account must be 1+ year old)
- All profiles linked to real LinkedIn identities
- Contact info only shared when you explicitly choose

## Setup (For Development)

### 1. Create Supabase Project

Go to [supabase.com](https://supabase.com) and create a free project.

### 2. Run Database Migration

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref your-project-ref

# Run migration
supabase db push
```

### 3. Deploy Edge Functions

```bash
supabase functions deploy linkedin-auth
supabase functions deploy ai-match
```

### 4. Create LinkedIn App

1. Go to [linkedin.com/developers](https://linkedin.com/developers)
2. Create an app
3. Add OAuth 2.0 redirect URL: `http://localhost:3847/callback`
4. Request scopes: `openid`, `profile`, `email`

### 5. Set Environment Variables

```bash
export OPENGIG_SUPABASE_URL=https://xxx.supabase.co
export OPENGIG_SUPABASE_ANON_KEY=your-anon-key
export OPENGIG_LINKEDIN_CLIENT_ID=your-client-id

# Optional: for AI-powered matching
export ANTHROPIC_API_KEY=sk-ant-...
```

### 6. Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

## Architecture

```
├── src/
│   ├── index.ts        # Launcher (starts Claude Code)
│   ├── mcp-server.ts   # MCP server (provides tools to Claude)
│   ├── types.ts        # TypeScript types
│   └── lib/
│       └── supabase.ts # Database client
│
├── supabase/
│   ├── migrations/     # Database schema
│   └── functions/      # Edge functions
│       ├── linkedin-auth/
│       └── ai-match/
│
└── CLAUDE.md           # Instructions for Claude
```

## MCP Tools

The MCP server provides these tools to Claude:

| Tool | Description |
|------|-------------|
| `auth_status` | Check login state |
| `create_listing` | Post job or availability |
| `search_listings` | Find jobs or talent |
| `get_conversations` | List message threads |
| `send_message` | Message someone |
| `get_messages` | Read a conversation |
| `share_contact` | Share email/phone/LinkedIn |
| `get_my_listings` | View your listings |
| `deactivate_listing` | Remove a listing |

## Contributing

Point Claude Code at this repo and help build it:

```bash
git clone https://github.com/ldraney/opengig
cd opengig
claude
# "Help me add email notifications for new messages"
```

### Roadmap

- [ ] Real LinkedIn account age verification
- [ ] Email notifications
- [ ] Profile editing
- [ ] Listing expiration
- [ ] Search filters
- [ ] Mobile-friendly auth flow

## License

MIT

## Revenue Model (Eventually)

Sponsored search results. That's it. Never transaction fees.
