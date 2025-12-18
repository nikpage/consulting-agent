import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateEmbedding } from './embeddings';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Simple strict keyword filter (fallback only)
const spamKeywords = ['unsubscribe', 'opt-out', 'marketing', 'promo', 'no-reply'];

function isSpam(messageText, classification) {
  if (classification === 'noise') return true;
  const lowerText = (messageText || '').toLowerCase();
  if (spamKeywords.some(kw => lowerText.includes(kw))) return true;
  return false;
}

export async function findOrCreateThread(supabase, userId, cpId, messageText, messageId, classification) {
  if (isSpam(messageText, classification)) {
    console.log('[THREAD] Skipping spam/irrelevant message');
    return null;
  }

  const embedding = await generateEmbedding(messageText);

  // Fetch active threads for this user
  const { data: activeThreads } = await supabase
    .from('conversation_threads')
    .select('id, topic, summary_text')
    .eq('user_id', userId)
    .eq('state', 'active');

  let bestThreadId = null;
  let maxSimilarity = -1;

  if (activeThreads && activeThreads.length > 0) {
    for (const thread of activeThreads) {
      // Compare with thread topic/summary
      const threadEmbedding = await generateEmbedding(thread.summary_text || thread.topic);
      const similarity = cosineSimilarity(embedding, threadEmbedding);
      // console.log(`[THREAD] Similarity: ${similarity.toFixed(3)}`);

      if (similarity > 0.75) { // Threshold
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          bestThreadId = thread.id;
        }
      }
    }
  }

  if (bestThreadId) {
    console.log(`[THREAD] ✓ Merged into existing thread`);
    // Add participant
    await supabase.from('thread_participants').upsert(
      { thread_id: bestThreadId, cp_id: cpId, added_at: new Date().toISOString() },
      { onConflict: 'thread_id, cp_id' }
    );
    // Update thread timestamp
    await supabase.from('conversation_threads')
      .update({ last_updated: new Date().toISOString() })
      .eq('id', bestThreadId);
    return bestThreadId;
  } else {
    // Create new thread
    const { data: cp } = await supabase.from('cps').select('name').eq('id', cpId).single();
    const topic = cp ? `Conversation with ${cp.name}` : `New Thread`;
    
    const { data: newThread, error } = await supabase
      .from('conversation_threads')
      .insert({
        user_id: userId,
        topic: topic,
        state: 'active',
        summary_text: messageText.substring(0, 100) + '...', // Temporary
        priority_score: 5,
        last_updated: new Date().toISOString(),
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error creating thread:', error);
      return null;
    }

    await supabase.from('thread_participants').insert({
      thread_id: newThread.id,
      cp_id: cpId,
      added_at: new Date().toISOString()
    });

    console.log(`[THREAD] Created new thread`);
    return newThread.id;
  }
}

export async function updateThreadSummary(supabase, threadId) {
  // Get last 10 messages
  const { data: allMessages } = await supabase
    .from('messages')
    .select('cleaned_text, timestamp')
    .eq('thread_id', threadId)
    .order('timestamp', { ascending: true })
    .limit(15);

  if (!allMessages || allMessages.length === 0) return;

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `
  You are a Real Estate Assistant.
  Review this conversation thread (Oldest to Newest):
  ${allMessages.map((m, i) => `[${i+1}] ${(m.cleaned_text || '').substring(0, 400)}`).join('\n\n')}

  OUTPUT IN CZECH ONLY.
  Write a "Strategic Summary" for the agent.
  Format: "Current Situation. Next Step."
  Example: "Klient potvrdil prohlídku na pátek. Musíme připravit podklady."
  Keep it under 40 words.
  `;

  try {
    const result = await model.generateContent(prompt);
    const summary = result.response.text().trim();

    await supabase.from('conversation_threads')
      .update({ 
        summary_text: summary,
        last_updated: new Date().toISOString()
      })
      .eq('id', threadId);

    console.log(`[THREAD] Updated summary for thread ${threadId.substring(0,8)}`);
  } catch (err) {
    console.error('Thread Summary Error:', err.message);
  }
}

function cosineSimilarity(a, b) {
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
