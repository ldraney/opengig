-- Add email_verified column to users table
-- This is the trust signal we use instead of account age

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;

-- Make linkedin_account_age_years optional (keep for backwards compatibility)
ALTER TABLE users ALTER COLUMN linkedin_account_age_years DROP NOT NULL;
ALTER TABLE users ALTER COLUMN linkedin_account_age_years SET DEFAULT NULL;
