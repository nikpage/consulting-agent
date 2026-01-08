import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateEmbedding } from '../../lib/embeddings';
import { AgentContext } from '../agentContext';
import { retry } from '../retryPolicy';

const spamKeywords = ['unsubscribe', 'opt-out', 'marketing', 'promo', 'no-reply'];

function isSpam(messageText: string, classification: any): boolean {
  if (classification?.relevance === 'NOISE') return true;
  const lowerText = (messageText || '').toLowerCase();
  if (spamKeywords.some(kw => lowerText.includes(kw))) return true;
  return false;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function threadEmail(
  ctx: AgentContext,
  cpId: string,
  messageText: string,
  messageId: string,
  classification: any
): Promise<string | null> {
  if (isSpam(messageText, classification)) {
    return null;
  }

  const embedding = await retry(() => generateEmbedding(messageText));

  // Fetch active threads for this user
  const { data: activeThreads } = await ctx.supabase
    .from('conversation_threads')
    .select('id, topic, summary_text')
    .eq('user_id', ctx.clientId)
    .eq('state', 'active');

  let bestThreadId = null;
  let maxSimilarity = -1;

  if (activeThreads && activeThreads.length > 0) {
    for (const thread of activeThreads) {
      // Compare with thread topic/summary
      const threadEmbedding = await retry(() => generateEmbedding(thread.summary_text || thread.topic));
      const similarity = cosineSimilarity(embedding, threadEmbedding);

      if (similarity > 0.75) {
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          bestThreadId = thread.id;
        }
      }
    }
  }

  if (bestThreadId) {
    // Add participant
    await ctx.supabase.from('thread_participants').upsert(
      { thread_id: bestThreadId, cp_id: cpId, added_at: new Date().toISOString() },
      { onConflict: 'thread_id, cp_id' }
    );
    // Update thread timestamp
    await ctx.supabase.from('conversation_threads')
      .update({ last_updated: new Date().toISOString() })
      .eq('id', bestThreadId);
    return bestThreadId;
  } else {
    // Create new thread
    const { data: cp } = await ctx.supabase.from('cps').select('name').eq('id', cpId).single();
    const topic = cp ? `Conversation with ${cp.name}` : `New Thread`;

    const { data: newThread, error } = await ctx.supabase
      .from('conversation_threads')
      .insert({
        user_id: ctx.clientId,
        topic: topic,
        state: 'active',
        summary_text: messageText.substring(0, 100) + '...',
        priority_score: 5,
        last_updated: new Date().toISOString(),
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error) {
      return null;
    }

    await ctx.supabase.from('thread_participants').insert({
      thread_id: newThread.id,
      cp_id: cpId,
      added_at: new Date().toISOString()
    });

    return newThread.id;
  }
}
