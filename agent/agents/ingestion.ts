// agent/agents/ingestion.ts

import type { AgentContext } from '../agentContext';
import { storeMessage } from '../../lib/ingestion';
import { resolveCp } from '../../lib/cp';
import { updateThreadSummary } from '../../lib/threading';
import { retry } from '../retryPolicy';
import { ingestEmail } from '../agentSteps/ingest';
import { classifyEmail } from '../agentSteps/classify';
import { threadEmail } from '../agentSteps/thread';
import { scheduleAction } from '../agentSteps/schedule';

export async function runIngestion(ctx: AgentContext): Promise<number> {
  let processedMessages = 0;

  const resList = await retry<any>(() =>
    ctx.gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      q: 'is:unread',
      maxResults: 10,
    })
  );

  const messages = resList.data.messages ?? [];

  for (const msgStub of messages) {
    const emailData = await ingestEmail(ctx, msgStub);
    if (!emailData) continue;

    const cpId = await resolveCp(ctx.supabase, ctx.client.id, emailData.from);

    const triage = await classifyEmail(emailData.cleanedText, ctx, null);

    if (triage.relevance === 'NOISE') {
      continue;
    }

    await storeMessage(ctx.supabase, ctx.client.id, cpId, emailData);
    processedMessages++;

    const threadId = await threadEmail(
      ctx,
      cpId,
      emailData.cleanedText,
      emailData.id,
      triage,
      emailData
    );

    if (threadId) {
      await ctx.supabase
        .from('messages')
        .update({
          thread_id: threadId,
          external_thread_id: emailData.threadId
        })
        .eq('id', emailData.id);

      let score = 1;
      if (triage.importance === 'CRITICAL') score = 10;
      else if (triage.importance === 'HIGH') score = 8;
      else if (triage.importance === 'REGULAR') score = 5;

      await ctx.supabase
        .from('conversation_threads')
        .update({ priority_score: score, last_updated: new Date().toISOString() })
        .eq('id', threadId);

      await updateThreadSummary(ctx.supabase, threadId);
    }

    await scheduleAction(ctx, cpId, triage, emailData, threadId);

    await retry(() => ctx.gmail.users.messages.modify({
      userId: 'me',
      id: msgStub.id,
      requestBody: { removeLabelIds: ['UNREAD'] }
    }));
  }

  return processedMessages;
}
