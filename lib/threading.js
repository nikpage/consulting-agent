import { generateEmbedding } from './embeddings.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const SIMILARITY_THRESHOLD = 0.65;

function calculateThreadPriority(dealType, state, daysIdle) {
  let score = 0;
  if (dealType === 'seller') score += 3; else score += 2;

  if (state === 'closing') score += 3;
  else if (state === 'negotiating') score += 2;
  else score += 1;

  if (daysIdle > 2) score += 1;
  return score;
}

export async function findOrCreateThread(supabase, userId, cpId, messageText, messageId, classification) {
  try {
    // 1. Check Spam
    if (classification?.primary === 'Inactive') return null;

    // 2. Find existing thread FOR THIS CONTACT
    const { data: existingParticipation } = await supabase
      .from('thread_participants')
      .select('thread_id, conversation_threads(id, state, topic, summary_text)')
      .eq('cp_id', cpId);

    let threadId = null;

    // Check if this contact already has an active thread
    if (existingParticipation?.length) {
      for (const p of existingParticipation) {
        const thread = p.conversation_threads;
        if (thread && thread.state !== 'idle') {
          threadId = thread.id;
          console.log(`[THREAD] Found existing thread for CP: ${threadId}`);
          break;
        }
      }
    }

    // 3. Create or Update
    const priorityScore = calculateThreadPriority(classification.deal_type, classification.state, 0);

    if (threadId) {
      await supabase.from('conversation_threads').update({
        last_updated: new Date().toISOString(),
        deal_type: classification.deal_type,
        state: classification.state,
        priority_score: priorityScore
      }).eq('id', threadId);
    } else {
      console.log(`[THREAD] Creating new thread for CP`);
      const { data: cp } = await supabase.from('cps').select('name').eq('id', cpId).single();
      const { data: newThread } = await supabase.from('conversation_threads').insert({
        user_id: userId,
        topic: cp?.name || 'Nový Kontakt',
        state: 'active',
        summary_text: 'Analyzuji...',
        deal_type: classification.deal_type,
        priority_score: priorityScore
      }).select('id').single();

      threadId = newThread.id;
      await supabase.from('thread_participants').insert({ thread_id: threadId, cp_id: cpId });
    }

    return threadId;

  } catch (err) {
    console.error('Threading Error:', err.message);
    return null;
  }
}

export async function updateThreadSummary(supabase, threadId) {
  try {
    const { data: msgs } = await supabase
      .from('messages')
      .select('cleaned_text, direction')
      .eq('thread_id', threadId)
      .order('timestamp', { ascending: true });

    if (!msgs?.length) return;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const text = msgs.map(m => `${m.direction === 'inbound' ? 'Klient' : 'Já'}: ${m.cleaned_text}`).join('\n');

    const prompt = `
      Role: Executive Assistant.
      Task: Summarize this deal conversation.

      CRITICAL: Write 2-3 sentences max. Be specific.
      - 35% = Brief history/context
      - 65% = Current situation and what needs to happen

      Language: Czech.

      Conversation:
      ${text.substring(0, 10000)}

      Output JSON: { "topic": "2-4 word deal identifier", "summary_text": "2-3 sentence summary" }
    `;

    const result = await model.generateContent(prompt);
    const json = JSON.parse(result.response.text().replace(/```json/g, '').replace(/```/g, '').trim());

    await supabase.from('conversation_threads').update({
      topic: json.topic,
      summary_text: json.summary_text,
      last_updated: new Date().toISOString()
    }).eq('id', threadId);

  } catch (err) {
    console.error('Summary Error:', err.message);
  }
}

function cosineSimilarity(a, b) {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
}
