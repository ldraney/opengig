import { createClient, SupabaseClient, Session as SupabaseSession } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { User } from '../types.js';

const CONFIG_DIR = join(homedir(), '.opengig');
const SESSION_FILE = join(CONFIG_DIR, 'supabase_session.json');

// Production Supabase credentials (anon key is safe to expose - it's public by design)
const DEFAULT_SUPABASE_URL = 'https://przjsrayrbkqxdgshdxv.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByempzcmF5cmJrcXhkZ3NoZHh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NTg3MzAsImV4cCI6MjA4MTUzNDczMH0._By-HVUW3263ymQEMPFxS0wQ9KTi0DUT1kjX1E2Jdj0';

// Allow override via environment for development
const supabaseUrl = process.env.OPENGIG_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = process.env.OPENGIG_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

let supabase: SupabaseClient | null = null;
let sessionInitialized = false;

export function getSupabaseUrl(): string {
  return supabaseUrl;
}

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Supabase not configured. Set OPENGIG_SUPABASE_URL and OPENGIG_SUPABASE_ANON_KEY environment variables.'
      );
    }
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false, // We manage persistence ourselves for CLI
      },
    });
  }
  return supabase;
}

// Initialize session from file - must be called before auth operations
export async function initializeSession(): Promise<void> {
  if (sessionInitialized) return;

  const db = getSupabase();
  const savedSession = loadSupabaseSession();
  if (savedSession) {
    await db.auth.setSession({
      access_token: savedSession.access_token,
      refresh_token: savedSession.refresh_token,
    });
  }
  sessionInitialized = true;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// Save Supabase session to file (for CLI persistence)
export function saveSupabaseSession(session: SupabaseSession): void {
  ensureConfigDir();
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

// Load Supabase session from file
export function loadSupabaseSession(): SupabaseSession | null {
  if (!existsSync(SESSION_FILE)) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
    // Check if expired
    if (data.expires_at && data.expires_at * 1000 < Date.now()) {
      clearSupabaseSession();
      return null;
    }
    return data as SupabaseSession;
  } catch {
    return null;
  }
}

// Clear saved session
export function clearSupabaseSession(): void {
  if (existsSync(SESSION_FILE)) {
    unlinkSync(SESSION_FILE);
  }
  // Also clear old session file if it exists
  const oldSessionFile = join(CONFIG_DIR, 'session.json');
  if (existsSync(oldSessionFile)) {
    unlinkSync(oldSessionFile);
  }
}

// Check if user is authenticated with valid session
export async function isAuthenticated(): Promise<boolean> {
  await initializeSession();
  const db = getSupabase();
  const { data: { session } } = await db.auth.getSession();
  return session !== null;
}

// Get current authenticated user from Supabase Auth + our users table
export async function getCurrentUser(): Promise<User | null> {
  await initializeSession();
  const db = getSupabase();
  const { data: { session } } = await db.auth.getSession();

  if (!session) return null;

  try {
    // Query our users table using auth.uid() - RLS will now work!
    const { data, error } = await db
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (error) {
      // User might not exist in our users table yet (first login)
      // Return basic info from auth
      if (error.code === 'PGRST116') {
        return null;
      }
      throw error;
    }
    return data as User;
  } catch {
    return null;
  }
}

// Get the current Supabase Auth session
export async function getSession(): Promise<SupabaseSession | null> {
  await initializeSession();
  const db = getSupabase();
  const { data: { session } } = await db.auth.getSession();
  return session;
}

export function isConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
