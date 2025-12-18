import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { getEmailDetails, storeMessage } from '../../lib/ingestion';
import { getOAuth2Client, setCredentials } from '../../lib/google-auth';
import { processMessagePipeline } from '../../lib/classification';
import { resolveCp } from '../../lib/cp';
import { findOrCreateThread } from '../../lib/threading';
import { handleAction } from '../../lib/scheduling';
import { renewIfExpiring } from '../../lib/calendar-setup';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { data: clients } = await supabase.from('users').select('*').not('google_oauth_tokens', 'is', null);

  for (const client of clients) {
    try {
      const tokens = typeof client.google_oauth_tokens === 'string' ? JSON.parse(client.google_oauth_tokens) : client.google_oauth_tokens;
      await renewIfExpiring(supabase, client.id, tokens, client.settings || {});
      
      const oauth2Client = setCredentials(tokens);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      
      const resList = await gmail.users.messages.list({ userId: 'me', q: 'newer_than:1d is:unread -category:promotions', maxResults: 10 });
      const messages = resList.data.messages || [];

      for (const msgStub of messages) {
        const emailData = await getEmailDetails(gmail, msgStub.id);
        const { data: existing } = await supabase.from('messages').select('id').eq('id', emailData.id).maybeSingle();
        if (existing) continue;

        console.log(`Processing: ${emailData.subject}`);
        const cpId = await resolveCp(supabase, client.id, emailData.from);

        // 1. TRIAGE
        const triage = await processMessagePipeline(emailData.cleanedText, null);

        if (triage.relevance === 'NOISE') {
           console.log('Skipping NOISE');
           continue; 
        }

        // 2. STORE with TAGS
        emailData.tag_primary = triage.relevance;   // SALES, BIZ, PERS
        emailData.tag_secondary = triage.importance; // CRIT, HIGH, REG, LOW
        
        await storeMessage(supabase, client.id, cpId, emailData);

        // 3. THREAD & SCORE
        const threadId = await findOrCreateThread(supabase, client.id, cpId, emailData.cleanedText, emailData.id, triage);
        
        if (threadId) {
           await supabase.from('messages').update({ thread_id: threadId }).eq('id', emailData.id);
           
           // Update Score based on Importance
           let score = 1;
           if (triage.importance === 'CRITICAL') score = 10;
           else if (triage.importance === 'HIGH') score = 8;
           else if (triage.importance === 'REGULAR') score = 5;

           await supabase.from('conversation_threads')
             .update({ priority_score: score, last_updated: new Date().toISOString() })
             .eq('id', threadId);
        }

        // 4. ACTION (Event/Todo)
        await handleAction(supabase, client.id, cpId, triage, emailData, threadId);

        // Mark Read
        await gmail.users.messages.modify({ userId: 'me', id: msgStub.id, requestBody: { removeLabelIds: ['UNREAD'] } });
      }

    } catch (e) {
      console.error(`Error ${client.email}:`, e.message);
    }
  }

  res.status(200).json({ status: 'OK' });
}
