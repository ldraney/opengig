// LinkedIn OAuth handler for opengig
// Exchanges auth code for tokens and creates/updates user

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const LINKEDIN_CLIENT_ID = Deno.env.get('LINKEDIN_CLIENT_ID')!;
const LINKEDIN_CLIENT_SECRET = Deno.env.get('LINKEDIN_CLIENT_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
}

interface LinkedInProfile {
  sub: string; // LinkedIn user ID
  name: string;
  given_name: string;
  family_name: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const { code, redirectUri } = await req.json();

    if (!code) {
      return new Response(JSON.stringify({ error: 'Missing authorization code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('LinkedIn token error:', errorText);
      return new Response(JSON.stringify({ error: 'Failed to exchange code for token' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tokenData: LinkedInTokenResponse = await tokenResponse.json();

    // Get user profile using OpenID Connect userinfo endpoint
    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!profileResponse.ok) {
      console.error('LinkedIn profile error:', await profileResponse.text());
      return new Response(JSON.stringify({ error: 'Failed to fetch LinkedIn profile' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const profile: LinkedInProfile = await profileResponse.json();

    // Require verified email as trust signal
    // LinkedIn has already validated this email belongs to the user
    if (!profile.email_verified) {
      return new Response(
        JSON.stringify({
          error: 'Email not verified',
          message: 'Your LinkedIn email must be verified to use opengig. Please verify your email in LinkedIn settings.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Create Supabase client with service role
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Create or update user
    const userData = {
      linkedin_id: profile.sub,
      linkedin_url: `https://www.linkedin.com/in/${profile.sub}`,
      name: profile.name,
      profile_pic: profile.picture,
      email: profile.email,
      email_verified: profile.email_verified,
      last_active: new Date().toISOString(),
    };

    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('linkedin_id', profile.sub)
      .single();

    let userId: string;

    if (existingUser) {
      // Update existing user
      await supabase
        .from('users')
        .update(userData)
        .eq('id', existingUser.id);
      userId = existingUser.id;
    } else {
      // Create new user
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert(userData)
        .select('id')
        .single();

      if (insertError) {
        console.error('Insert error:', insertError);
        return new Response(JSON.stringify({ error: 'Failed to create user' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      userId = newUser.id;
    }

    // Generate session expiry (30 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    return new Response(
      JSON.stringify({
        userId,
        accessToken: tokenData.access_token,
        expiresAt: expiresAt.toISOString(),
        name: profile.name,
        email: profile.email,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Auth error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
