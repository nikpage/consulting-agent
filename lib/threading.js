import { generateEmbedding } from './embeddings';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const SIMILARITY_THRESHOLD = 0.6;

async function isAutomatedMessage(messageText) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
  
  const prompt = 'Is this from an automated system (login alert, security warning, newsletter, marketing, app notification) or a real person writing a real message?\n\nText: "' + messageText.substring(0, 500) + '"\n\nAnswer only: AUTOMATED or REAL';

  try {
    const result = await model.generateContent(prompt);
    const answer = result.response.text().trim().toUpperCase();
    return answer.includes('AUTOMATED');
  } catch (err) {
    return false;
  }
}

export async function findOrCreateThread(supabase, userId, cpId, messageText, messageId) {
  try {
    const isSpam = await isAutomatedMessage(messageText);
    if (isSpam) {
      console.log('[THREAD] Skipping automated message');
      return null;
    }

    const embedding = await generateEmbedding(messageText);
    if (!embedding) {
      return await createNewThread(supabase, userId, cpId, messageText);
    }

    const { data: existingThreads } = await supabase
      .from('conversation_threads')
      .select('id, topic, summary_text')
      .eq('user_id', userId)
      .eq('state', 'active');

    if (existingThreads && existingThreads.length > 0) {
      let bestMatch = null;
      let bestScore = 0;

      for (const thread of existingThreads) {
        const threadEmbedding = await generateEmbedding(thread.summary_text || thread.topic);
        if (threadEmbedding) {
          const similarity = cosineSimilarity(embedding, threadEmbedding);
          console.log('[THREAD] Similarity with "' + thread.topic.substring(0, 30) + '": ' + similarity.toFixed(3));
          
          if (similarity > bestScore && similarity > SIMILARITY_THRESHOLD) {
            bestScore = similarity;
            bestMatch = thread;
          }
        }
      }

      if (bestMatch) {
        console.log('[THREAD] Merged into: ' + bestMatch.topic);
        
        await supabase.from('thread_participants').upsert(
          { thread_id: bestMatch.id, cp_id: cpId },
          { onConflict: 'thread_id,cp_id' }
        );
        
        await supabase.from('conversation_threads')
          .update({ last_updated: new Date().toISOString() })
          .eq('id', bestMatch.id);
        
        return bestMatch.id;
      }
    }

    return await createNewThread(supabase, userId, cpId, messageText);

  } catch (err) {
    console.error('Threading Error:', err.message);
    return null;
  }
}

async function createNewThread(supabase, userId, cpId, messageText) {
  const { data: cp } = await supabase.from('cps').select('name').eq('id', cpId).single();
  const senderName = cp ? cp.name : 'Contact';
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
  let headline = senderName;
  
  try {
    const prompt = 'Create a 3-5 word headline in Czech for this conversation:\n\n"' + messageText.substring(0, 300) + '"\n\nOutput only the headline. Example: "Byt Dejvice - prohlídka"';
    const result = await model.generateContent(prompt);
    headline = senderName + ' - ' + result.response.text().trim();
  } catch (err) {
    headline = senderName;
  }
  
  const { data: newThread } = await supabase
    .from('conversation_threads')
    .insert({
      user_id: userId,
      topic: headline,
      state: 'active',
      summary_text: messageText.substring(0, 500)
    })
    .select('id')
    .single();

  await supabase.from('thread_participants').insert({
    thread_id: newThread.id,
    cp_id: cpId
  });

  console.log('[THREAD] Created: ' + headline);
  return newThread.id;
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
      return;
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const msgText = allMessages.map(function(m, i) {
      return '[' + (i+1) + '] ' + m.cleaned_text.substring(0, 400);
    }).join('\n\n');

    const prompt = 'Create a brief summary in Czech for a salesperson:\n\n' + msgText + '\n\n3-4 sentences: What is this about? Current status? Key facts (prices, dates, next steps)?\n\nOutput plain text only.';

    const result = await model.generateContent(prompt);
    const summary = result.response.text().trim();

    await supabase
      .from('conversation_threads')
      .update({ 
        summary_text: summary,
        last_updated: new Date().toISOString()
      })
      .eq('id', threadId);

    console.log('[THREAD] Summary updated');

  } catch (err) {
    console.error('Thread Summary Error:', err.message);
  }
}

function cosineSimilarity(a, b) {
  var dotProduct = 0;
  var normA = 0;
  var normB = 0;
  
  for (var i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
