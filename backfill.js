import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { getOAuth2Client } from './lib/google-auth.js';
import { getEmailDetails, storeMessage } from './lib/ingestion.js';
import { resolveCp } from './lib/cp.js';
import { processMessagePipeline } from './lib/classification.js';
import { findOrCreateThread, updateThreadSummary } from './lib/threading.js';

// Setup Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

/**
 * Retries a function with exponential backoff if a Rate Limit (429) is encountered.
 */
async function retryWithBackoff(fn, retries = 10) {
  let attempts = 0;
  while (attempts < retries) {
    try {
      return await fn();
    } catch (error) {
      const msg = error.message || JSON.stringify(error);
      const isRateLimit = msg.includes('429') ||
                          msg.includes('Quota') ||
                          msg.includes('Too Many Requests');

      if (isRateLimit) {
        attempts++;
        // Backoff: 2s, 4s, 8s, 16s...
        const delay = Math.pow(2, attempts) * 1000;
        console.warn(`[RATE LIMIT] Retrying in ${delay/1000}s (Attempt ${attempts}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Failed after ${retries} retries due to rate limiting.`);
}

async function backfill() {
  console.log('--- STARTING BACKFILL ---');

  const { data: users, error } = await supabase.from('users').select('*');

  if (error || !users?.length) {
    console.error('Error fetching users:', error);
    return;
  }

  for (const user of users) {
    try {
      let tokens = user.google_oauth_tokens;
      if (typeof tokens === 'string') {
        try {
          tokens = JSON.parse(tokens);
        } catch (e) {
          console.log(`Skipping ${user.email}: Invalid token format`);
          continue;
        }
      }

      if (!tokens) continue;

      console.log(`Processing: ${user.email}`);

      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials(tokens);
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

        for (const msg of messages) {
          try {
            const { data: existing } = await supabase.from('messages').select('id').eq('external_id', msg.id).maybeSingle();
            if (existing) {
              process.stdout.write('.');
              continue;
            }

            const emailData = await getEmailDetails(gmail, msg.id);

            // Skip sent emails
            if (emailData.from.includes(user.email)) {
               process.stdout.write('s');
               continue;
            }

            const cpId = await resolveCp(supabase, user.id, emailData.from);

            // --- WRAPPED CALL 1: Classification ---
            const classification = await retryWithBackoff(() =>
                processMessagePipeline(emailData.cleanedText, null)
            );

            await storeMessage(supabase, user.id, cpId, emailData);

            // --- WRAPPED CALL 2: Threading ---
            const threadId = await retryWithBackoff(() =>
                findOrCreateThread(supabase, user.id, cpId, emailData.cleanedText, emailData.id, classification)
            );

            if (threadId) {
              // --- WRAPPED CALL 3: Summarization ---
              await retryWithBackoff(() =>
                  updateThreadSummary(supabase, threadId)
              );
            }

            process.stdout.write('✓');
            count++;

          } catch (innerErr) {
            console.error(`\nError processing msg ${msg.id}:`, innerErr.message);
          }
        }
        pageToken = res.data.nextPageToken;
      } while (pageToken);

      console.log(`\nDone. Ingested ${count} messages for ${user.email}.`);

    } catch (err) {
      console.error(`\nFailed on user ${user.email}: ${err.message}`);
    }
  }
}

backfill();
