import { generateEmbedding } from './embeddings.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const SIMILARITY_THRESHOLD = 0.65;

function calculateThreadPriority(dealType, state, daysIdle) {
  let score = 0;
  if (dealType === 'seller') score += 3; else score += 2; // Sellers > Buyers
  
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

    // 2. Embed & Search
    const embedding = await generateEmbedding(messageText);
    if (!embedding) return null;

    const { data: existingThreads } = await supabase
      .from('conversation_threads')
      .select('id, topic, summary_text')
      .eq('user_id', userId)
      .eq('state', 'active');

    let threadId = null;

    if (existingThreads?.length) {
      for (const thread of existingThreads) {
        const threadEmbedding = await generateEmbedding(thread.summary_text || thread.topic);
        if (threadEmbedding && cosineSimilarity(embedding, threadEmbedding) > SIMILARITY_THRESHOLD) {
          threadId = thread.id;
          break;
        }
      }
    }

    // 3. Create or Update
    const priorityScore = calculateThreadPriority(classification.deal_type, classification.state, 0);

    if (threadId) {
      console.log(`[THREAD] Merging into ${threadId}`);
      await supabase.from('thread_participants').upsert({ thread_id: threadId, cp_id: cpId }, { onConflict: 'thread_id,cp_id' });
      await supabase.from('conversation_threads').update({ 
          last_updated: new Date().toISOString(),
          deal_type: classification.deal_type,
          state: classification.state,
          priority_score: priorityScore
        }).eq('id', threadId);
    } else {
      console.log(`[THREAD] Creating New`);
      const { data: cp } = await supabase.from('cps').select('name').eq('id', cpId).single();
      const { data: newThread } = await supabase.from('conversation_threads').insert({
          user_id: userId,
          topic: cp?.name || 'Nový Kontakt',
          state: 'active',
          summary_text: 'Analyzuji...', // Placeholder until updated
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
      Role: Executive Assistant (Pepper Potts).
      Task: Summarize this deal. 
      
      CRITICAL: DO NOT copy the emails. Write a synthesis.
      Language: Czech (Čeština).

      Structure:
      1. **Topic**: 2-4 words identifying the property or deal.
      2. **Summary**: 
         - 35% History (Context).
         - 65% Current Status (What is happening NOW).
      
      Conversation:
      ${text.substring(0, 15000)}
      
      Output JSON: { "topic": "string", "summary_text": "string" }
    `;

    const result = await model.generateContent(prompt);
    const json = JSON.parse(result.response.text().replace(/^```json/gm, '').replace(/^```/gm, '').trim());

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
