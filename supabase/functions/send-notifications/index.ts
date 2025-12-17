/**
 * Edge function to send pending email notifications
 * Triggered by cron job or manual invocation
 *
 * Requires RESEND_API_KEY environment variable
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
}

interface User {
  id: string;
  email: string;
  name: string;
}

Deno.serve(async (req) => {
  // Verify request (optional: add API key check)
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Get pending notifications (limit to 50 per run)
    const { data: notifications, error: fetchError } = await supabase
      .from('notifications')
      .select('*')
      .eq('email_sent', false)
      .order('created_at', { ascending: true })
      .limit(50);

    if (fetchError) throw fetchError;

    if (!notifications || notifications.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No pending notifications', sent: 0 }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get unique user IDs
    const userIds = [...new Set(notifications.map((n: Notification) => n.user_id))];

    // Fetch user emails
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, email, name')
      .in('id', userIds);

    if (usersError) throw usersError;

    const userMap = new Map((users || []).map((u: User) => [u.id, u]));

    // Send emails
    let sent = 0;
    const errors: string[] = [];

    for (const notification of notifications as Notification[]) {
      const user = userMap.get(notification.user_id);

      if (!user?.email) {
        errors.push(`No email for user ${notification.user_id}`);
        continue;
      }

      try {
        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'opengig <notifications@opengig.dev>',
            to: user.email,
            subject: `[opengig] ${notification.title}`,
            html: generateEmailHtml(notification, user),
          }),
        });

        if (emailResponse.ok) {
          // Mark as sent
          await supabase
            .from('notifications')
            .update({ email_sent: true, sent_at: new Date().toISOString() })
            .eq('id', notification.id);
          sent++;
        } else {
          const errorData = await emailResponse.text();
          errors.push(`Failed to send to ${user.email}: ${errorData}`);
        }
      } catch (emailError) {
        errors.push(`Email error for ${user.email}: ${emailError}`);
      }
    }

    return new Response(
      JSON.stringify({
        message: `Processed ${notifications.length} notifications`,
        sent,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

function generateEmailHtml(notification: Notification, user: User): string {
  const actionUrl = getActionUrl(notification);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${notification.title}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #0d1117; color: #e6edf3; padding: 40px 20px; margin: 0;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #161b22; border-radius: 12px; padding: 32px; border: 1px solid #30363d;">
    <div style="margin-bottom: 24px;">
      <span style="font-size: 24px; font-weight: 700; color: #e6edf3;">open</span><span style="font-size: 24px; font-weight: 700; color: #58a6ff;">gig</span>
    </div>

    <h1 style="font-size: 20px; margin: 0 0 16px 0; color: #e6edf3;">${notification.title}</h1>

    <p style="font-size: 16px; line-height: 1.6; color: #8b949e; margin: 0 0 24px 0;">
      Hi ${user.name || 'there'},
    </p>

    <p style="font-size: 16px; line-height: 1.6; color: #e6edf3; margin: 0 0 24px 0;">
      ${notification.body}
    </p>

    ${actionUrl ? `
    <a href="${actionUrl}" style="display: inline-block; background-color: #58a6ff; color: #0d1117; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
      View Details
    </a>
    ` : ''}

    <hr style="border: none; border-top: 1px solid #30363d; margin: 32px 0;">

    <p style="font-size: 12px; color: #8b949e; margin: 0;">
      You're receiving this because you have notifications enabled on opengig.
      <br>
      To manage your preferences, run <code style="background: #0d1117; padding: 2px 6px; border-radius: 4px;">npx opengig</code> and update your saved searches.
    </p>
  </div>
</body>
</html>
  `.trim();
}

function getActionUrl(notification: Notification): string | null {
  // For now, just link to the main site
  // In the future, could deep-link to specific conversations/listings
  return 'https://ldraney.github.io/opengig/';
}
