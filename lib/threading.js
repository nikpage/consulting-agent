import { generateEmbedding } from './embeddings.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const SIMILARITY_THRESHOLD = 0.65;

function isSpam(messageText, classification) {
  const spamKeywords = [
    'sign-in', 'security alert', 'new sign-in', 'unsubscribe',
    'newsletter', 'sale', 'discount', 'click here', 'buy now',
    'allowed assistant access', 'google account'
  ];

  const lowerText = (messageText || '').toLowerCase();
  if (spamKeywords.some(kw => lowerText.includes(kw))) return true;
  if (classification?.primary === 'Inactive') return true;

  return false;
}

export async function findOrCreateThread(supabase, userId, cpId, messageText, messageId, classification) {
  try {
    if (isSpam(messageText, classification)) {
      console.log('[THREAD] Skipping spam/irrelevant message');
      return null;
    }

    const embedding = await generateEmbedding(messageText);
    if (!embedding) return null;

    const { data: existingThreads } = await supabase
      .from('conversation_threads')
      .select('id, topic, summary_text')
      .eq('user_id', userId)
      .eq('state', 'active');

    if (existingThreads && existingThreads.length > 0) {
      for (const thread of existingThreads) {
        const threadEmbedding = await generateEmbedding(thread.summary_text || thread.topic);
        if (threadEmbedding) {
          const similarity = cosineSimilarity(embedding, threadEmbedding);
          console.log(`[THREAD] Similarity: ${similarity.toFixed(3)}`);

          if (similarity > SIMILARITY_THRESHOLD) {
            console.log(`[THREAD] ✓ Merged into existing thread`);

            await supabase.from('thread_participants').upsert(
              { thread_id: thread.id, cp_id: cpId },
              { onConflict: 'thread_id,cp_id' }
            );

            await supabase.from('conversation_threads')
              .update({ last_updated: new Date().toISOString() })
              .eq('id', thread.id);

            return thread.id;
          }
        }
      }
    }

    const { data: cp } = await supabase.from('cps').select('name').eq('id', cpId).single();
    const topic = `Conversation with ${cp?.name || 'Contact'}`;

    const { data: newThread } = await supabase
      .from('conversation_threads')
      .insert({
        user_id: userId,
        topic: topic,
        state: 'active',
        summary_text: messageText.substring(0, 500)
      })
      .select('id')
      .single();

    await supabase.from('thread_participants').insert({
      thread_id: newThread.id,
      cp_id: cpId
    });

    console.log(`[THREAD] Created new thread`);
    return newThread.id;

  } catch (err) {
    console.error('Threading Error:', err.message);
    return null;
  }
}

export async function updateThreadSummary(supabase, threadId) {
  try {
    const { data: allMessages } = await supabase
      .from('messages')
      .select('cleaned_text, timestamp')
      .eq('thread_id', threadId)
      .order('timestamp', { ascending: true });

    if (!allMessages || allMessages.length === 0) return;

    if (allMessages.length === 1) {
      const short = (allMessages[0].cleaned_text || '').substring(0, 200);
      await supabase.from('conversation_threads')
        .update({ summary_text: short, last_updated: new Date().toISOString() })
        .eq('id', threadId);
      return;
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `
You are an executive assistant creating a BRIEF for a busy salesperson.

Timeline (${allMessages.length} messages, oldest to newest):
${allMessages.map((m, i) => `[${i+1}] ${(m.cleaned_text || '').substring(0, 400)}`).join('\n\n')}

Create a 3-4 sentence executive brief in Czech:
1. ONE sentence: What's this about? (e.g., "Negotiation for house on Novodvorská 13")
2. ONE sentence: History/context if multi-message thread
3. TWO sentences: Current status and KEY FACTS (prices, dates, conditions, next actions)

Rules:
- NO repetition of email content
- Focus on BUSINESS INTELLIGENCE, not email text
- Extract: prices, dates, deadlines, decisions, blockers
- Write what the salesperson NEEDS TO KNOW, not what was said

Output plain text only.
`;

    const result = await model.generateContent(prompt);
    const summary = result.response.text().trim();

    await supabase
      .from('conversation_threads')
      .update({
        summary_text: summary,
        last_updated: new Date().toISOString()
      })
      .eq('id', threadId);

    console.log(`[THREAD] Updated summary (${allMessages.length} msgs) for thread ${threadId.substring(0,8)}`);

  } catch (err) {
    console.error('Thread Summary Error:', err.message);
  }
}

function cosineSimilarity(a, b) {
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
