import { generateEmbedding } from './embeddings';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const SIMILARITY_THRESHOLD = 0.65;

const SUMMARY_PROMPT = `
You are an expert sales briefing agent...
Now, summarize the following thread:
`;

function isSpam(messageText, classification) {
  const spamKeywords = [
    'sign-in','security alert','new sign-in','unsubscribe',
    'newsletter','sale','discount','click here','buy now',
    'allowed assistant access','google account'
  ];

  const lowerText = messageText.toLowerCase();
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

    if (existingThreads?.length) {
      for (const thread of existingThreads) {
        const threadEmbedding = await generateEmbedding(thread.summary_text || thread.topic);
        if (!threadEmbedding) continue;

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

    const { data: cp } = await supabase.from('cps').select('name').eq('id', cpId).single();

    const topic = `${cp?.name || 'Contact'}`; // OPTION A

    const { data: newThread } = await supabase
      .from('conversation_threads')
      .insert({
        user_id: userId,
        topic,
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
      .select('cleaned_text, sender_name')
      .eq('thread_id', threadId)
      .order('timestamp', { ascending: true });

    if (!allMessages?.length) return;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const conversationText = allMessages.map(m => `${m.sender_name || 'Sender'}: ${m.cleaned_text}`).join('\n');
    const fullPrompt = `${SUMMARY_PROMPT}\n---\nConversation:\n${conversationText}`;

    const result = await model.generateContent(fullPrompt);
    const geminiResponseText = result.response.text();

    let aiSummary;
    try {
      const jsonString = geminiResponseText.replace(/^```json/gm, '').replace(/^```/gm, '').trim();
      aiSummary = JSON.parse(jsonString);
    } catch {
      const { data: existingThread } =
        await supabase.from('conversation_threads').select('topic').eq('id', threadId).single();

      aiSummary = {
        topic: existingThread?.topic || `Error Thread`,
        summary_text: geminiResponseText.trim()
      };
    }

    await supabase.from('conversation_threads')
      .update({
        topic: aiSummary.topic,
        summary_text: aiSummary.summary_text,
        last_updated: new Date().toISOString()
      })
      .eq('id', threadId);

    console.log(`[THREAD] Updated summary for thread ${threadId}`);

  } catch (err) {
    console.error('Thread Summary Error:', err.message);
  }
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
