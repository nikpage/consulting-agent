// lib/threading.js

import { generateEmbedding } from './embeddings';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const SIMILARITY_THRESHOLD = 0.65;

const SUMMARY_PROMPT = `
You are an expert sales briefing agent. Your task is to summarize the provided conversation thread (which may contain multiple emails/messages) for a sales representative.
Your output MUST be a JSON object with two fields:
1. "topic": A concise, actionable title for the conversation, replacing generic titles like "Conversation with X". This MUST be a deal name, address, or critical subject (e.g., "Novodvorská 13 Contract", "Kesnerka 6 Heating Details").
2. "summary_text": A brief, actionable summary in Czech, detailing the current state, next action required, and the counterparty.
---
Example Input:
"Pavel: Chci se godiva na stav odpadu and topeni v to baraku na Kesnerka 6 v praze. a kdistak to pridame do smlouvy, jo>? sejdem se tam zytra nebo ve stredu? / Sarah: Zítra nemohu, ale ve středu v 10:00 je volno."
Example Output:
{
  "topic": "Kesnerka 6 Schůzka a Topení",
  "summary_text": "S klientem Pavlem domluvena schůzka na středu v 10:00 k projednání detailů odpadu a topení, které se přidají do smlouvy. Akce: Připravit podklady topení."
}
---
Now, summarize the following thread:
`;

function isSpam(messageText, classification) {
  const spamKeywords = [
    'sign-in', 'security alert', 'new sign-in', 'unsubscribe',
    'newsletter', 'sale', 'discount', 'click here', 'buy now',
    'allowed assistant access', 'google account'
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
<<<<<<< Updated upstream
    const topic = `Conversation with ${cp?.name || 'Contact'}`;

=======
    const topic = `${cp?.name || 'Contact'}`;
    
>>>>>>> Stashed changes
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
      .select('cleaned_text, sender_name')
      .eq('thread_id', threadId)
      .order('timestamp', { ascending: true });

    if (!allMessages || allMessages.length === 0) return;

    // --- AI summary now runs regardless of message count. ---

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    // 2. Format the conversation for the AI
    const conversationText = allMessages.map(m => `${m.sender_name || 'Sender'}: ${m.cleaned_text}`).join('\n');

    const fullPrompt = `${SUMMARY_PROMPT}\n---\nConversation:\n${conversationText}`;

    const result = await model.generateContent(fullPrompt);
    const geminiResponseText = result.response.text();

    let aiSummary;
    try {
        // Attempt to parse the JSON output from the structured prompt
        const jsonString = geminiResponseText.replace(/^```json/gm, '').replace(/^```/gm, '').trim();
        aiSummary = JSON.parse(jsonString);
    } catch (e) {
        console.error('AI did not return valid JSON. Falling back to simple text summary.', e.message);
        // Fallback: If AI fails to return JSON, use the raw response for the summary text
        // and keep the existing thread topic.
        const { data: existingThread } = await supabase.from('conversation_threads').select('topic').eq('id', threadId).single();

        aiSummary = {
            topic: existingThread?.topic || `Error Thread ${threadId.substring(0, 8)}`,
            summary_text: geminiResponseText.trim()
        };
    }

    // 4. Update the thread in the database
    await supabase.from('conversation_threads')
      .update({
          topic: aiSummary.topic,              // Now contains the real topic
          summary_text: aiSummary.summary_text, // Now contains the real summary
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
