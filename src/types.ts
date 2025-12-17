// Core types for opengig

export interface User {
  id: string;
  linkedin_id: string;
  linkedin_url: string;
  name: string;
  headline?: string;
  profile_pic?: string;
  email?: string;
  phone?: string;
  linkedin_account_age_years: number;
  connection_count?: number;
  created_at: string;
  last_active: string;
}

export interface Listing {
  id: string;
  user_id: string;
  type: 'job' | 'available';
  title: string;
  description: string;
  skills: string[];
  rate_min?: number;
  rate_max?: number;
  rate_type?: 'hourly' | 'fixed' | 'negotiable';
  location?: string;
  remote: boolean;
  created_at: string;
  expires_at?: string;
  active: boolean;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  read: boolean;
  created_at: string;
}

export interface Conversation {
  id: string;
  participant_ids: string[];
  listing_id?: string;
  created_at: string;
  last_message_at: string;
}

export interface ContactShare {
  id: string;
  sharer_id: string;
  recipient_id: string;
  email?: string;
  phone?: string;
  linkedin_url: string;
  message?: string;
  created_at: string;
}

export interface Match {
  listing: Listing;
  user: User;
  score: number;
  reasons: string[];
}

export interface Session {
  user_id: string;
  access_token: string;
  refresh_token?: string;
  expires_at: string;
}
