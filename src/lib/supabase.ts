import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Session, User } from '../types.js';

const CONFIG_DIR = join(homedir(), '.opengig');
const SESSION_FILE = join(CONFIG_DIR, 'session.json');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// These will be set from environment or config
let supabaseUrl = process.env.OPENGIG_SUPABASE_URL || '';
let supabaseAnonKey = process.env.OPENGIG_SUPABASE_ANON_KEY || '';

// Load config if exists
if (existsSync(CONFIG_FILE)) {
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    supabaseUrl = supabaseUrl || config.supabaseUrl || '';
    supabaseAnonKey = supabaseAnonKey || config.supabaseAnonKey || '';
  } catch {
    // Ignore config errors
  }
}

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Supabase not configured. Set OPENGIG_SUPABASE_URL and OPENGIG_SUPABASE_ANON_KEY environment variables.'
      );
    }
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabase;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function saveSession(session: Session): void {
  ensureConfigDir();
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

export function loadSession(): Session | null {
  if (!existsSync(SESSION_FILE)) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      return null;
    }
    return data as Session;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (existsSync(SESSION_FILE)) {
    writeFileSync(SESSION_FILE, '{}');
  }
}

export async function getCurrentUser(): Promise<User | null> {
  const session = loadSession();
  if (!session) return null;

  try {
    const db = getSupabase();
    const { data, error } = await db
      .from('users')
      .select('*')
      .eq('id', session.user_id)
      .single();

    if (error) throw error;
    return data as User;
  } catch {
    return null;
  }
}

export function isConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
