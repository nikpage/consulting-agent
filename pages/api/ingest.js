import { google } from 'googleapis';
import { supabase } from '../../lib/supabase';
import { getEmailDetails, storeMessage } from '../../lib/ingestion';
import { resolveCp } from '../../lib/cp';
import { processMessagePipeline } from '../../lib/classification';
import { findOrCreateThread, updateThreadSummary } from '../../lib/threading';
import { handleAction } from '../../lib/scheduling';
import { getOAuth2Client } from '../../lib/google-auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ALWAYS USE THE SINGLE USER IN THE SYSTEM
    const { data: users, error: userErr } = await supabase
      .from('users')
      .select('id, google_oauth_tokens, email')
      .limit(1);

    if (userErr || !users || users.length === 0) {
      return res.status(500).json({ error: 'No user found' });
    }

    const user = users[0];
    const userId = user.id;

    // OAUTH SETUP
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(user.google_oauth_tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // GET NEWEST MESSAGE
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 1,
      q: 'newer_than:5d -category:promotions -category:social'
    });

    if (!listRes.data.messages || listRes.data.messages.length === 0) {
      return res.status(200).json({ status: 'no messages' });
    }

    const messageId = listRes.data.messages[0].id;

    // FETCH EMAIL DATA
    const emailData = await getEmailDetails(gmail, messageId);
    if (!emailData) {
      return res.status(404).json({ error: 'Email data not found' });
    }

    // RESOLVE CP
    const cpId = await resolveCp(supabase, userId, emailData.from);

    // CLASSIFICATION
    const { data: previousThread } = await supabase
      .from('conversation_threads')
      .select('summary_text')
      .eq('user_id', userId)
      .order('last_updated', { ascending: false })
      .limit(1)
      .single();

    const contextSummary = previousThread?.summary_text || '';
    const classification = await processMessagePipeline(
      emailData.cleanedText,
      contextSummary
    );

    // STORE MESSAGE
    await storeMessage(supabase, userId, cpId, emailData);

    // THREADING
    const threadId = await findOrCreateThread(
      supabase,
      userId,
      cpId,
      emailData.cleanedText,
      emailData.id,
      classification
    );

    if (threadId) {
      await updateThreadSummary(supabase, threadId);
      await handleAction(supabase, userId, cpId, classification, emailData);
    }

    return res.status(200).json({
      success: true,
      threadId,
      action: classification.secondary
    });

  } catch (err) {
    console.error('[INGEST] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
