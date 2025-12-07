import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { getEmailDetails, storeMessage } from '../../lib/ingestion';
import { resolveCp } from '../../lib/cp';
import { processMessagePipeline } from '../../lib/classification';
import { handleAction } from '../../lib/scheduling';
import { setCredentials } from '../../lib/google-auth';
import { generateEmbedding, storeEmbedding } from '../../lib/embeddings';
import { findOrCreateThread, updateThreadSummary } from '../../lib/threading';
import { renewIfExpiring } from '../../lib/calendar-setup';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// RETRY HELPER: Handles 503 Overload / 429 Rate Limits
async function withRetry(operation, retries = 3, delay = 60000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (err) {
            const isOverload = err.message.includes('503') || err.message.includes('429');
            if (i === retries - 1 || !isOverload) throw err;
            console.log(`   ⚠️ System Busy (503/429). Retrying in ${delay/1000}s...`);
            await wait(delay);
        }
    }
}

async function getCurrentSummary(cpId) {
    const { data } = await supabase.from('cp_states').select('summary_text').eq('cp_id', cpId).maybeSingle();
    return data ? data.summary_text : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stats = { users: 0, messages: 0, skipped: 0, inactive: 0, errors: 0 };

  try {
    const { data: clients, error } = await supabase.from('users').select('*').not('google_oauth_tokens', 'is', null);
    if (error) throw error;
    stats.users = clients.length;

    for (const client of clients) {
      console.log(`\n--- Processing Client: ${client.email} ---`);
      try {
        const tokens = typeof client.google_oauth_tokens === 'string' ? JSON.parse(client.google_oauth_tokens) : client.google_oauth_tokens;
        const oauth2Client = setCredentials(tokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Renew calendar webhook if expiring
        await renewIfExpiring(supabase, client.id, tokens, client.settings || {});

        // LIMIT: Fetch only top 15 messages (No pagination loop)
        const resList = await gmail.users.messages.list({ userId: 'me', q: 'newer_than:5d -category:promotions -category:social -subject:"Daily Brief"', maxResults: 15 });
        const messages = resList.data.messages || [];

        for (const msgStub of messages) {
            try {
            const emailData = await getEmailDetails(gmail, msgStub.id);
            if (!emailData.cleanedText) continue;

            // ROBUST FILTER: Matches Czech chars OR the Agent ID (ASCII)
            const subj = emailData.subject || '';
            if (
                subj.includes('Denní Přehled') ||
                subj.includes('Daily Brief') ||
                subj.includes('Special Agent 23') // <--- Failsafe for encoding issues
            ) {
                    stats.skipped++;
                    continue;
            }

            const { data: existing } = await supabase.from('messages').select('id').eq('id', emailData.id).maybeSingle();
            if (existing) {
                console.log(`- Skipping known msg: ${subj.substring(0, 30)}...`);
                stats.skipped++;
                continue;
            }

            console.log(`+ Processing NEW: ${subj.substring(0, 50)}...`);
            const cpId = await resolveCp(supabase, client.id, emailData.from);
            const currentSummary = await getCurrentSummary(cpId);

            // PROCESS WITH RETRY
            const pipelineResult = await withRetry(() => processMessagePipeline(emailData.cleanedText, currentSummary));

            // SKIP SPAM/INACTIVE
            if (pipelineResult.primary === 'Inactive') {
                console.log(`  > Detected Noise/Inactive. Skipping.`);
                stats.inactive++;
                continue;
            }

            await storeMessage(supabase, client.id, cpId, emailData);
            const embedding = await generateEmbedding(emailData.cleanedText);
            await storeEmbedding(supabase, emailData.id, embedding);
            const threadId = await findOrCreateThread(supabase, client.id, cpId, emailData.cleanedText, emailData.id);
            if (threadId) await supabase.from('messages').update({ thread_id: threadId }).eq('id', emailData.id);
            if (threadId) await updateThreadSummary(supabase, threadId);

            if (pipelineResult.primary === 'Inactive') {
                console.log(`  > Detected Noise/Inactive. No actions taken.`);
                stats.inactive++;
            } else {
                await supabase.from('cp_states').upsert({
                    cp_id: cpId, state: pipelineResult.state, summary_text: pipelineResult.summary, last_updated: new Date().toISOString()
                });

                // SCHEDULE WITH RETRY
                await withRetry(() => handleAction(supabase, client.id, cpId, pipelineResult, emailData));
            }

            try { await gmail.users.messages.modify({ userId: 'me', id: msgStub.id, requestBody: { addLabelIds: ['STARRED'] } }); } catch (e) {}

            stats.messages++;

            } catch (innerErr) {
            console.error(`❌ Msg Error ${msgStub.id}:`, innerErr.message);
            stats.errors++;
            }
        }

      } catch (clientErr) {
        console.error(`Client Error ${client.email}:`, clientErr.message);
        stats.errors++;
      }
    }
    res.status(200).json({ status: 'OK', stats });
  } catch (fatalErr) {
    res.status(500).json({ error: fatalErr.message });
  }
}
