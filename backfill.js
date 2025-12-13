import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { getOAuth2Client } from './lib/google-auth.js';
import { getEmailDetails, storeMessage } from './lib/ingestion.js';
import { resolveCp } from './lib/cp.js';
import { processMessagePipeline } from './lib/classification.js';
import { findOrCreateThread, updateThreadSummary } from './lib/threading.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

async function backfill() {
  console.log('--- STARTING BACKFILL FROM DEC 6 ---');

  const { data: users } = await supabase.from('users').select('*').limit(1);
  if (!users?.length) { console.error('No user found'); return; }
  const user = users[0];

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(user.google_oauth_tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  let pageToken = null;
  let count = 0;

  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'after:2025/12/06 -category:promotions -category:social -category:updates -category:forums',
      maxResults: 50,
      pageToken: pageToken
    });

    const messages = res.data.messages || [];
    console.log(`> Found page with ${messages.length} messages...`);

    for (const msg of messages) {
      try {
        const { data: existing } = await supabase.from('messages').select('id').eq('external_id', msg.id).maybeSingle();
        if (existing) {
          process.stdout.write('.');
          continue;
        }

        const emailData = await getEmailDetails(gmail, msg.id);

        if (emailData.from.includes(user.email)) {
          process.stdout.write('s');
          continue;
        }

        const cpId = await resolveCp(supabase, user.id, emailData.from);
        const classification = await processMessagePipeline(emailData.cleanedText, null);

        await storeMessage(supabase, user.id, cpId, emailData);

        const threadId = await findOrCreateThread(supabase, user.id, cpId, emailData.cleanedText, emailData.id, classification);
        if (threadId) {
          await updateThreadSummary(supabase, threadId);
        }

        process.stdout.write('✓');
        count++;

      } catch (err) {
        console.error(`\n[Error msg ${msg.id}]:`, err.message);
      }
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);

  console.log(`\n\n--- BACKFILL COMPLETE. Ingested ${count} new messages. ---`);
}

backfill();
