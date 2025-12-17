# opengig

**Free, open freelance marketplace. Terminal-native. AI-assisted. No fees ever.**

## What is this?

opengig turns [Claude Code](https://claude.ai/code) into a freelance marketplace. No web UI - just conversation:

```
You: "I'm looking for React work, remote, around $80/hr"

Claude: Found 3 matching jobs! Here are the top ones:

1. **React Native Developer** - FinTech Startup
   - $70-100/hr, remote
   - Skills: React Native, TypeScript, mobile

Want me to help you reach out?
```

## Why?

| Platform | Take Rate | UX |
|----------|-----------|-----|
| Upwork | 10-20% | Web forms |
| Fiverr | 20% | Web forms |
| LinkedIn | Expensive | Bloated |
| **opengig** | **0%** | **Conversation** |

We just connect people. Payment happens between you.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/ldraney/opengig
cd opengig
npm install

# Configure (see Setup below)
cp .env.example .env

# Launch Claude Code with marketplace tools
claude
```

Then just talk:
- "I'm available for Python/Django work, $100/hr"
- "Find me someone who knows AWS and Terraform"
- "Check my messages"
- "Share my email with Jane"

## How it Works

```
┌─────────────────────────────────────────────────────────┐
│  You run: claude (in opengig directory)                 │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│  Claude Code loads .mcp.json                            │
│  → Starts opengig MCP server                            │
│  → Reads CLAUDE.md for context                          │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│  MCP Tools Available:                                   │
│  • search_listings  • create_listing  • send_message    │
│  • share_contact    • get_conversations  • auth_status  │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│  Supabase Backend                                       │
│  • Users (LinkedIn-verified)                            │
│  • Listings (jobs + availability)                       │
│  • Messages + Contact Shares                            │
└─────────────────────────────────────────────────────────┘
```

## Setup

### 1. Create Supabase Project

Go to [supabase.com](https://supabase.com) and create a free project.

### 2. Run Database Migration

In Supabase Dashboard → SQL Editor, paste contents of:
```
supabase/migrations/001_initial_schema.sql
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```bash
OPENGIG_SUPABASE_URL=https://your-project.supabase.co
OPENGIG_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Create Test Session (For Development)

```bash
# First, insert a test user via Supabase SQL Editor:
# INSERT INTO users (id, linkedin_id, linkedin_url, name, email, linkedin_account_age_years)
# VALUES ('your-uuid-here', 'test', 'https://linkedin.com/in/you', 'Your Name', 'you@email.com', 2);

# Then create local session:
mkdir -p ~/.opengig
echo '{"user_id":"your-uuid-here","access_token":"test","expires_at":"2026-01-01T00:00:00.000Z"}' > ~/.opengig/session.json
```

### 5. Launch

```bash
claude
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `auth_status` | Check login state and profile |
| `create_listing` | Post a job or availability |
| `search_listings` | Find jobs or talent |
| `get_conversations` | List message threads |
| `send_message` | Message someone |
| `get_messages` | Read a conversation |
| `share_contact` | Share email/phone/LinkedIn |
| `get_my_listings` | View your listings |
| `deactivate_listing` | Remove a listing |

## Trust Model

- LinkedIn OAuth required (account must be 1+ year old)
- All profiles linked to real LinkedIn identities
- Contact info only shared when you explicitly choose
- Row-level security on all data

## Roadmap

### Phase 1: Core MVP ✅
- [x] MCP server with marketplace tools
- [x] Supabase schema with RLS
- [x] Search listings (jobs/talent)
- [x] Create listings
- [x] Messaging system
- [x] Contact sharing

### Phase 2: Production Auth
- [ ] Deploy LinkedIn OAuth edge function
- [ ] Real account age verification
- [ ] Session management via Supabase Auth
- [ ] Profile sync from LinkedIn

### Phase 3: Distribution
- [ ] Publish to npm (`npx opengig`)
- [ ] CLI launcher auto-configures MCP
- [ ] One-command onboarding
- [ ] Landing page

### Phase 4: Growth Features
- [ ] Email notifications
- [ ] Saved searches / alerts
- [ ] Listing expiration & renewal
- [ ] Advanced search filters
- [ ] Reputation signals from LinkedIn

### Phase 5: Monetization
- [ ] Sponsored listings (pay to boost)
- [ ] Featured placement in search
- [ ] Analytics for posters
- **Never transaction fees**

## Contributing

Point Claude Code at this repo and help build:

```bash
git clone https://github.com/ldraney/opengig
cd opengig
claude
# "Help me implement email notifications for new messages"
```

### Key Areas Needing Work

- **Auth**: Deploy LinkedIn OAuth edge function
- **Distribution**: npm package setup
- **Testing**: Add test coverage
- **Features**: Email notifications, search filters

## Architecture

```
opengig/
├── src/
│   ├── index.ts        # CLI launcher
│   ├── mcp-server.ts   # MCP server (the magic)
│   ├── types.ts        # TypeScript types
│   └── lib/
│       └── supabase.ts # Database + sessions
├── supabase/
│   ├── migrations/     # Database schema
│   └── functions/      # Edge functions
├── .mcp.json           # Claude Code MCP config
├── CLAUDE.md           # AI instructions
└── README.md           # You are here
```

## License

MIT

## Revenue Model

Sponsored search results. That's it. **Never transaction fees.**

---

Built with [Claude Code](https://claude.ai/code) 🤖
