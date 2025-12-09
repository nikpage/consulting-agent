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

    if (userError || !user || !user.google_oauth_tokens) {
      console.error('[INGEST] User auth missing', userError);
      return res.status(401).json({ error: 'User not authenticated' });
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
