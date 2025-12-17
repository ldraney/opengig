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

## Current Status: Alpha

**What's working:**
- npm package published (`npx opengig`)
- LinkedIn OAuth edge function deployed
- MCP server with 9 marketplace tools
- Supabase backend configured

**Blocker before production:**
- RLS policies require Supabase Auth migration (see [Issue #1](https://github.com/ldraney/opengig/issues/1))
- Currently writes to database will fail due to RLS

## Quick Start (For Development)

```bash
# Install
npm install -g opengig

# Authenticate via LinkedIn
opengig auth

# Launch Claude Code with marketplace tools
opengig
```

Or run directly:
```bash
npx opengig auth
npx opengig
```

Then just talk:
- "I'm available for Python/Django work, $100/hr"
- "Find me someone who knows AWS and Terraform"
- "Check my messages"
- "Share my email with Jane"

## How it Works

```
┌─────────────────────────────────────────────────────────┐
│  You run: opengig (or npx opengig)                      │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│  CLI checks auth, launches Claude Code                  │
│  → Configures MCP server automatically                  │
│  → Reads CLAUDE.md for AI context                       │
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
│  • Users (LinkedIn-verified, email must be verified)    │
│  • Listings (jobs + availability)                       │
│  • Messages + Contact Shares                            │
└─────────────────────────────────────────────────────────┘
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

- LinkedIn OAuth required
- Email must be verified by LinkedIn
- All profiles linked to real LinkedIn identities
- Contact info only shared when you explicitly choose

## Roadmap

### Phase 1: Core MVP ✅
- [x] MCP server with marketplace tools
- [x] Supabase schema
- [x] Search, create listings, messaging, contact sharing
- [x] npm package published
- [x] LinkedIn OAuth edge function deployed

### Phase 2: Production Auth 🚧 IN PROGRESS
- [x] LinkedIn OAuth edge function
- [x] Email verification as trust signal
- [ ] **Migrate to Supabase Auth** (BLOCKER - RLS depends on this)
- [ ] Profile sync from LinkedIn

### Phase 3: Distribution
- [x] Publish to npm
- [ ] Landing page
- [ ] Documentation site

### Phase 4: Growth Features
- [ ] Email notifications
- [ ] Saved searches / alerts
- [ ] Listing expiration & renewal
- [ ] Advanced search filters

### Phase 5: Monetization
- [ ] Sponsored listings (pay to boost)
- [ ] Featured placement in search
- **Never transaction fees**

## Contributing

```bash
git clone https://github.com/ldraney/opengig
cd opengig
npm install
```

### Priority: Supabase Auth Migration

The biggest blocker is migrating from custom OAuth to Supabase Auth. See [Issue #1](https://github.com/ldraney/opengig/issues/1) for details.

### Development Setup

```bash
# Copy environment template
cp .env.example .env

# Edit with your Supabase credentials (or use defaults)
# The npm package has production defaults baked in

# Run in dev mode
npm run dev
```

## Architecture

```
opengig/
├── src/
│   ├── index.ts        # CLI launcher
│   ├── mcp-server.ts   # MCP server (9 tools)
│   ├── types.ts        # TypeScript types
│   └── lib/
│       └── supabase.ts # Database + sessions
├── supabase/
│   ├── migrations/     # Database schema
│   └── functions/      # Edge functions (linkedin-auth)
├── .mcp.json           # Claude Code MCP config
├── CLAUDE.md           # AI assistant instructions
└── README.md           # You are here
```

## License

MIT

---

Built with [Claude Code](https://claude.ai/code)
