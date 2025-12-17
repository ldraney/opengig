-- opengig database schema
-- Free, open freelance marketplace

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (linked to LinkedIn)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    linkedin_id TEXT UNIQUE NOT NULL,
    linkedin_url TEXT NOT NULL,
    name TEXT NOT NULL,
    headline TEXT,
    profile_pic TEXT,
    email TEXT,
    phone TEXT,
    linkedin_account_age_years INTEGER NOT NULL DEFAULT 0,
    connection_count INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for LinkedIn lookups
CREATE INDEX idx_users_linkedin_id ON users(linkedin_id);

-- Listings table (jobs OR availability)
CREATE TABLE listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('job', 'available')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    skills TEXT[] NOT NULL DEFAULT '{}',
    rate_min INTEGER,
    rate_max INTEGER,
    rate_type TEXT CHECK (rate_type IN ('hourly', 'fixed', 'negotiable')),
    location TEXT,
    remote BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT true
);

-- Indexes for search
CREATE INDEX idx_listings_type ON listings(type);
CREATE INDEX idx_listings_skills ON listings USING GIN(skills);
CREATE INDEX idx_listings_active ON listings(active);
CREATE INDEX idx_listings_user_id ON listings(user_id);

-- Full text search on title and description
ALTER TABLE listings ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || description)) STORED;
CREATE INDEX idx_listings_search ON listings USING GIN(search_vector);

-- Conversations table
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_ids UUID[] NOT NULL,
    listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_participants UNIQUE (participant_ids)
);

-- Index for finding user's conversations
CREATE INDEX idx_conversations_participants ON conversations USING GIN(participant_ids);

-- Messages table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for messages
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_recipient_unread ON messages(recipient_id, read) WHERE NOT read;

-- Contact shares table (audit trail of contact info exchanges)
CREATE TABLE contact_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sharer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    phone TEXT,
    linkedin_url TEXT,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for contact shares
CREATE INDEX idx_contact_shares_recipient ON contact_shares(recipient_id);
CREATE INDEX idx_contact_shares_sharer ON contact_shares(sharer_id);

-- Row Level Security (RLS) policies

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_shares ENABLE ROW LEVEL SECURITY;

-- Users: anyone can read, only owner can update
CREATE POLICY "Users are viewable by everyone" ON users FOR SELECT USING (true);
CREATE POLICY "Users can update own record" ON users FOR UPDATE USING (auth.uid()::text = id::text);

-- Listings: anyone can read active, owner can CRUD
CREATE POLICY "Active listings are viewable by everyone" ON listings FOR SELECT USING (active = true);
CREATE POLICY "Users can insert own listings" ON listings FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);
CREATE POLICY "Users can update own listings" ON listings FOR UPDATE USING (auth.uid()::text = user_id::text);
CREATE POLICY "Users can delete own listings" ON listings FOR DELETE USING (auth.uid()::text = user_id::text);

-- Conversations: only participants can access
CREATE POLICY "Users can view own conversations" ON conversations
    FOR SELECT USING (auth.uid()::text = ANY(participant_ids::text[]));
CREATE POLICY "Users can create conversations they're part of" ON conversations
    FOR INSERT WITH CHECK (auth.uid()::text = ANY(participant_ids::text[]));
CREATE POLICY "Users can update own conversations" ON conversations
    FOR UPDATE USING (auth.uid()::text = ANY(participant_ids::text[]));

-- Messages: sender or recipient can access
CREATE POLICY "Users can view messages in their conversations" ON messages
    FOR SELECT USING (auth.uid()::text = sender_id::text OR auth.uid()::text = recipient_id::text);
CREATE POLICY "Users can send messages" ON messages
    FOR INSERT WITH CHECK (auth.uid()::text = sender_id::text);
CREATE POLICY "Recipients can mark messages as read" ON messages
    FOR UPDATE USING (auth.uid()::text = recipient_id::text);

-- Contact shares: sharer can create, recipient can view
CREATE POLICY "Users can share their contact info" ON contact_shares
    FOR INSERT WITH CHECK (auth.uid()::text = sharer_id::text);
CREATE POLICY "Recipients can view contact shares" ON contact_shares
    FOR SELECT USING (auth.uid()::text = recipient_id::text OR auth.uid()::text = sharer_id::text);

-- Function to update last_active timestamp
CREATE OR REPLACE FUNCTION update_last_active()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE users SET last_active = NOW() WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update last_active when user creates a listing
CREATE TRIGGER update_user_last_active_on_listing
    AFTER INSERT ON listings
    FOR EACH ROW
    EXECUTE FUNCTION update_last_active();
