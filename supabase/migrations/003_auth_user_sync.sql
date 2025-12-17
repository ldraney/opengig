-- Migration: Sync Supabase Auth users to our users table
-- This creates a user record in our public.users table whenever
-- someone signs up through Supabase Auth (LinkedIn OIDC)

-- Function to handle new user signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (
    id,
    linkedin_id,
    linkedin_url,
    name,
    email,
    email_verified,
    profile_pic,
    last_active,
    created_at
  )
  VALUES (
    NEW.id,
    -- LinkedIn OIDC provides 'sub' as the LinkedIn user ID in raw_user_meta_data
    COALESCE(NEW.raw_user_meta_data->>'sub', ''),
    -- Construct LinkedIn URL from sub if available
    CASE
      WHEN NEW.raw_user_meta_data->>'sub' IS NOT NULL
      THEN 'https://www.linkedin.com/in/' || (NEW.raw_user_meta_data->>'sub')
      ELSE ''
    END,
    -- Name from user metadata
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1),
      'User'
    ),
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'email_verified')::boolean, false),
    NEW.raw_user_meta_data->>'picture',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    email_verified = EXCLUDED.email_verified,
    profile_pic = EXCLUDED.profile_pic,
    last_active = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function on new auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Also update user on auth.users update (e.g., when they re-login)
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Allow the users table to have NULL/empty linkedin_id for Supabase Auth users
-- First drop the existing unique constraint (might be named differently)
DO $$
BEGIN
  -- Try to drop the constraint by common naming patterns
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_linkedin_id_key;
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_linkedin_id_unique;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Drop any existing unique index on linkedin_id
DROP INDEX IF EXISTS users_linkedin_id_key;
DROP INDEX IF EXISTS idx_users_linkedin_id_unique;

-- Now we can safely alter the columns
ALTER TABLE users ALTER COLUMN linkedin_id DROP NOT NULL;
ALTER TABLE users ALTER COLUMN linkedin_url DROP NOT NULL;

-- Set default empty string for linkedin_id to avoid NULL issues
ALTER TABLE users ALTER COLUMN linkedin_id SET DEFAULT '';
ALTER TABLE users ALTER COLUMN linkedin_url SET DEFAULT '';

-- Create a partial unique index that only applies to non-empty linkedin_ids
CREATE UNIQUE INDEX IF NOT EXISTS users_linkedin_id_unique_nonempty
  ON users(linkedin_id)
  WHERE linkedin_id IS NOT NULL AND linkedin_id != '';

-- Add policy for users to view their own record (needed for auth.uid() check)
DROP POLICY IF EXISTS "Users can view own record" ON users;
CREATE POLICY "Users can view own record" ON users
  FOR SELECT USING (auth.uid() = id);

-- Keep the public view policy but also ensure authenticated users can see all
DROP POLICY IF EXISTS "Users are viewable by everyone" ON users;
CREATE POLICY "Authenticated users can view all users" ON users
  FOR SELECT USING (auth.role() = 'authenticated');

-- Allow users to insert their own record (for edge cases)
DROP POLICY IF EXISTS "Users can insert own record" ON users;
CREATE POLICY "Users can insert own record" ON users
  FOR INSERT WITH CHECK (auth.uid() = id);
