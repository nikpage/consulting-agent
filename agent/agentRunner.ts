import type { gmail_v1 } from 'googleapis';

import { storeMessage } from '../lib/ingestion';
import { resolveCp } from '../lib/cp';
import { renewIfExpiring } from '../lib/calendar-setup';
import { createAgentContext } from './agentContext';
import { retry } from './retryPolicy';
import { ingestEmail } from './agentSteps/ingest';
import { classifyEmail } from './agentSteps/classify';
import { threadEmail } from './agentSteps/thread';
import { scheduleAction } from './agentSteps/schedule';

export async function runAgentForClient(clientId: string): Promise<{
  clientId: string;
  processedMessages: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let processedMessages = 0;

  try {
    // Create context
    const ctx = await createAgentContext(clientId);

    if (!ctx) {
      errors.push('Failed to create agent context');
      return { clientId, processedMessages: 0, errors };
    }

    // Renew calendar webhook
    const tokens = typeof ctx.client.google_oauth_tokens === 'string'
      ? JSON.parse(ctx.client.google_oauth_tokens)
      : ctx.client.google_oauth_tokens;

    await renewIfExpiring(ctx.supabase, ctx.client.id, tokens, ctx.client.settings || {});

    // List messages (exact logic from ingest.js)
    const resList = await retry<any>(() =>
      ctx.gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX'],
        q: 'is:unread',
        maxResults: 10,
      })
    );

    const messages = resList.data.messages ?? [];

    // Process each message
    for (const msgStub of messages) {
      try {
        // 1. INGEST
        const emailData = await ingestEmail(ctx, msgStub);
        if (!emailData) continue;

        const cpId = await resolveCp(ctx.supabase, ctx.client.id, emailData.from);

        // 2. CLASSIFY
        const triage = await classifyEmail(emailData.cleanedText, ctx, null);

        if (triage.relevance === 'NOISE') {
          continue;
        }

        // 3. STORE
        await storeMessage(ctx.supabase, ctx.client.id, cpId, emailData);
        processedMessages++;

        // 4. THREAD
        const threadId = await threadEmail(
          ctx,
          cpId,
          emailData.cleanedText,
          emailData.id,
          triage
        );

        if (threadId) {
          await ctx.supabase
            .from('messages')
            .update({ thread_id: threadId })
            .eq('id', emailData.id);

          // Update Score based on Importance
          let score = 1;
          if (triage.importance === 'CRITICAL') score = 10;
          else if (triage.importance === 'HIGH') score = 8;
          else if (triage.importance === 'REGULAR') score = 5;

          await ctx.supabase
            .from('conversation_threads')
            .update({ priority_score: score, last_updated: new Date().toISOString() })
            .eq('id', threadId);
        }

        // 5. SCHEDULE
        await scheduleAction(ctx, cpId, triage, emailData, threadId);

        // Mark Read
        await retry(() => ctx.gmail.users.messages.modify({
          userId: 'me',
          id: msgStub.id,
          requestBody: { removeLabelIds: ['UNREAD'] }
        }));

      } catch (msgError: any) {
        errors.push(`Message ${msgStub.id}: ${msgError.message}`);
      }
    }

  } catch (clientError: any) {
    errors.push(`Client processing: ${clientError.message}`);
  }

  return { clientId, processedMessages, errors };
}
