import { google } from 'googleapis';
import { getOAuth2Client } from './google-auth.js';

export async function setupCalendarWebhook(supabase, userId, tokens) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const channelId = `cal-${userId}-${Date.now()}`;
  const webhookUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/api/calendar-webhook`;

  try {
    const res = await calendar.events.watch({
      calendarId: 'primary',
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl
      }
    });

    const expiration = res.data.expiration;
    await supabase
      .from('users')
      .update({
        settings: {
          calendar_channel_id: channelId,
          calendar_webhook_expires: expiration
        }
      })
      .eq('id', userId);

    console.log(`[CALENDAR] Webhook setup for user ${userId}, expires: ${new Date(parseInt(expiration)).toISOString()}`);
    return res.data;
  } catch (err) {
    console.error('Calendar webhook setup error:', err.message);
    return null;
  }
}

export async function renewIfExpiring(supabase, userId, tokens, settings) {
  const expires = settings?.calendar_webhook_expires;
  if (!expires) {
    return await setupCalendarWebhook(supabase, userId, tokens);
  }

  const expiresDate = new Date(parseInt(expires));
  const now = new Date();
  const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  if (expiresDate < oneDayFromNow) {
    console.log(`[CALENDAR] Webhook expiring soon, renewing...`);
    return await setupCalendarWebhook(supabase, userId, tokens);
  }

  return null;
}
