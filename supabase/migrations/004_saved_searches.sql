-- Saved searches for alerts
-- Users can save search criteria and get notified of new matches

CREATE TABLE saved_searches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    search_type TEXT NOT NULL CHECK (search_type IN ('jobs', 'talent')),
    query TEXT,
    skills_filter TEXT[] DEFAULT '{}',
    rate_min INTEGER,
    rate_max INTEGER,
    remote_only BOOLEAN DEFAULT false,
    location TEXT,
    notify_email BOOLEAN DEFAULT true,
    last_checked_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT true
);

-- Index for user lookups
CREATE INDEX idx_saved_searches_user ON saved_searches(user_id);
CREATE INDEX idx_saved_searches_active ON saved_searches(active) WHERE active = true;

-- Enable RLS
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;

-- Users can only access their own saved searches
CREATE POLICY "Users can view own saved searches" ON saved_searches
    FOR SELECT USING (auth.uid()::text = user_id::text);
CREATE POLICY "Users can insert own saved searches" ON saved_searches
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);
CREATE POLICY "Users can update own saved searches" ON saved_searches
    FOR UPDATE USING (auth.uid()::text = user_id::text);
CREATE POLICY "Users can delete own saved searches" ON saved_searches
    FOR DELETE USING (auth.uid()::text = user_id::text);
