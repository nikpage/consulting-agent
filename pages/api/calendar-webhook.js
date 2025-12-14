import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { getOAuth2Client } from '../../lib/google-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const channelId = req.headers['x-goog-channel-id'];
  const resourceState = req.headers['x-goog-resource-state'];

  if (resourceState === 'sync') {
    return res.status(200).json({ status: 'sync acknowledged' });
  }

  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('settings->calendar_channel_id', channelId)
      .single();

    if (!user) {
      return res.status(200).json({ status: 'no user found' });
    }

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(user.google_oauth_tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const { data: events } = await calendar.events.list({
      calendarId: 'primary',
      updatedMin: fiveMinAgo.toISOString(),
      singleEvents: true
    });

    for (const event of events.items || []) {
      const cpEmail = event.extendedProperties?.private?.cpEmail;
      const eventStatus = event.extendedProperties?.private?.status;

      if (eventStatus === 'suggested' && event.status === 'confirmed') {
        console.log(`[WEBHOOK] Event confirmed: ${event.summary}`);

        if (cpEmail) {
          await calendar.events.patch({
            calendarId: 'primary',
            eventId: event.id,
            requestBody: {
              attendees: [{ email: cpEmail }],
              extendedProperties: {
                private: {
                  cpEmail: cpEmail,
                  status: 'confirmed'
                }
              }
            },
            sendUpdates: 'all'
          });
          console.log(`[WEBHOOK] Invite sent to ${cpEmail}`);

          await supabase
            .from('events')
            .update({ status: 'scheduled' })
            .eq('title', event.summary)
            .eq('user_id', user.id);
        }
      }
    }

    res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(200).json({ status: 'error', message: err.message });
  }
}
