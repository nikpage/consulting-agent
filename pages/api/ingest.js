import { google } from 'googleapis';
import { supabase } from '../../lib/supabase';
import { getEmailDetails, storeMessage } from '../../lib/ingestion';
import { resolveCp } from '../../lib/cp';
import { processMessagePipeline } from '../../lib/classification';
import { findOrCreateThread, updateThreadSummary } from '../../lib/threading';
import { handleAction } from '../../lib/scheduling';
import { getOAuth2Client } from '../../lib/google-auth';

export default async function handler(req, res) {
  // 1. Validate Request Method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. Validate Input Parameters
  const { userId, messageId } = req.body;

  if (!userId || !messageId) {
    return res.status(400).json({ error: 'Missing userId or messageId in request body' });
  }

  try {
    // 3. Setup Google OAuth Client
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('google_oauth_tokens, email')
      .eq('id', userId)
      .single();

<<<<<<< Updated upstream
    if (userError || !user || !user.google_oauth_tokens) {
      console.error('[INGEST] User auth missing', userError);
      return res.status(401).json({ error: 'User not authenticated' });
=======
    for (const client of clients) {
      console.log(`\n--- Processing Client: ${client.email} ---`);
      try {
        const tokens = typeof client.google_oauth_tokens === 'string' ? JSON.parse(client.google_oauth_tokens) : client.google_oauth_tokens;
        const oauth2Client = setCredentials(tokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        await renewIfExpiring(supabase, client.id, tokens, client.settings || {});

        const resList = await gmail.users.messages.list({ userId: 'me', q: 'newer_than:5d -category:promotions -category:social -subject:"Daily Brief"', maxResults: 15 });
        const messages = resList.data.messages || [];

        for (const msgStub of messages) {
            try {
            const emailData = await getEmailDetails(gmail, msgStub.id);
            if (!emailData.cleanedText) continue;

            const subj = emailData.subject || '';
            if (subj.includes('Denní Přehled') || subj.includes('Daily Brief') || subj.includes('')) {
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
            const commandOverrides = await processAdminCommands(emailData.cleanedText);

            // 2. PROCESS COMMANDS (This runs "Save:..." and returns overrides like "Buffer:...")
            if (commandOverrides.travelOverride) {
                console.log(`   🛠️ Command Detected: Overriding travel buffer to ${commandOverrides.travelOverride}m`);
            }

            const pipelineResult = await withRetry(() => processMessagePipeline(emailData.cleanedText, currentSummary));
            if (commandOverrides.travelOverride) pipelineResult.travelOverride = commandOverrides.travelOverride;

            // 3. INJECT OVERRIDES INTO PIPELINE RESULT
            if (commandOverrides.travelOverride) {
                pipelineResult.travelOverride = commandOverrides.travelOverride;
            }

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
>>>>>>> Stashed changes
    }

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(user.google_oauth_tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // 4. Fetch & Parse Email
    // (Throws "Unauthorized" if PIN is enabled and missing/invalid)
    const emailData = await getEmailDetails(gmail, messageId);

    if (!emailData) {
      return res.status(404).json({ error: 'Email data not found' });
    }

    // 5. Resolve Contact Person (CP)
    // (Handles "Spoofed" sender from Forwarding logic)
    const cpId = await resolveCp(supabase, userId, emailData.from);

    // 6. Run AI Classification Pipeline
    // Retrieve context from the most recent thread for this user
    const { data: previousThread } = await supabase
        .from('conversation_threads')
        .select('summary_text')
        .eq('user_id', userId)
        .order('last_updated', { ascending: false })
        .limit(1)
        .single();

    const contextSummary = previousThread?.summary_text || '';
    const classification = await processMessagePipeline(emailData.cleanedText, contextSummary);

    // 7. Store Message in DB
    await storeMessage(supabase, userId, cpId, emailData);

    // 8. Manage Threading (Find or Create)
    const threadId = await findOrCreateThread(supabase, userId, cpId, emailData.cleanedText, emailData.id, classification);

    if (threadId) {
      // 9. Update Thread Summary (Runs immediately for every message)
      await updateThreadSummary(supabase, threadId);

      // 10. Handle Actions (Scheduling, Todos, Maps Lookup)
      await handleAction(supabase, userId, cpId, classification, emailData);
    }

    return res.status(200).json({
      success: true,
      threadId,
      action: classification.secondary
    });

  } catch (err) {
    console.error('[INGEST] Error:', err.message);

    if (err.message.includes('Unauthorized') || err.message.includes('PIN')) {
        return res.status(403).json({ error: 'Security PIN Validation Failed' });
    }

    return res.status(500).json({ error: err.message });
  }
}
