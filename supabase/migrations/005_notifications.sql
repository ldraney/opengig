-- Notification queue for email alerts
-- Tracks pending notifications to be sent

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('new_match', 'message_received', 'listing_expiring', 'contact_shared')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    email_sent BOOLEAN DEFAULT false,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for processing unsent notifications
CREATE INDEX idx_notifications_unsent ON notifications(email_sent, created_at) WHERE NOT email_sent;
CREATE INDEX idx_notifications_user ON notifications(user_id);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "Users can view own notifications" ON notifications
    FOR SELECT USING (auth.uid()::text = user_id::text);

-- System can insert notifications (via service role)
CREATE POLICY "Service role can insert notifications" ON notifications
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role can update notifications" ON notifications
    FOR UPDATE USING (true);

-- Function to create notification when new message is received
CREATE OR REPLACE FUNCTION notify_on_new_message()
RETURNS TRIGGER AS $$
BEGIN
    -- Don't notify if user is the sender
    IF NEW.sender_id != NEW.recipient_id THEN
        INSERT INTO notifications (user_id, type, title, body, metadata)
        SELECT
            NEW.recipient_id,
            'message_received',
            'New message received',
            LEFT(NEW.content, 100) || CASE WHEN LENGTH(NEW.content) > 100 THEN '...' ELSE '' END,
            jsonb_build_object(
                'conversation_id', NEW.conversation_id,
                'sender_id', NEW.sender_id,
                'message_id', NEW.id
            );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new messages
DROP TRIGGER IF EXISTS on_new_message_notify ON messages;
CREATE TRIGGER on_new_message_notify
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION notify_on_new_message();

-- Function to create notification when contact is shared
CREATE OR REPLACE FUNCTION notify_on_contact_share()
RETURNS TRIGGER AS $$
DECLARE
    sharer_name TEXT;
BEGIN
    SELECT name INTO sharer_name FROM users WHERE id = NEW.sharer_id;

    INSERT INTO notifications (user_id, type, title, body, metadata)
    VALUES (
        NEW.recipient_id,
        'contact_shared',
        'Contact info shared with you',
        COALESCE(sharer_name, 'Someone') || ' shared their contact information with you',
        jsonb_build_object(
            'sharer_id', NEW.sharer_id,
            'share_id', NEW.id
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for contact shares
DROP TRIGGER IF EXISTS on_contact_share_notify ON contact_shares;
CREATE TRIGGER on_contact_share_notify
    AFTER INSERT ON contact_shares
    FOR EACH ROW
    EXECUTE FUNCTION notify_on_contact_share();

-- Function to create notification when listing is about to expire (7 days)
-- This would be called by a scheduled job
CREATE OR REPLACE FUNCTION check_expiring_listings()
RETURNS void AS $$
BEGIN
    INSERT INTO notifications (user_id, type, title, body, metadata)
    SELECT
        l.user_id,
        'listing_expiring',
        'Listing expiring soon',
        'Your listing "' || l.title || '" expires in ' ||
            EXTRACT(DAY FROM l.expires_at - NOW())::int || ' days',
        jsonb_build_object('listing_id', l.id, 'expires_at', l.expires_at)
    FROM listings l
    WHERE l.active = true
        AND l.expires_at IS NOT NULL
        AND l.expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        AND NOT EXISTS (
            SELECT 1 FROM notifications n
            WHERE n.user_id = l.user_id
                AND n.type = 'listing_expiring'
                AND n.metadata->>'listing_id' = l.id::text
                AND n.created_at > NOW() - INTERVAL '7 days'
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
