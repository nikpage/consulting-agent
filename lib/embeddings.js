import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function generateEmbedding(text) {
  if (!text || text.length < 10) return null;
  
  try {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    console.error('Embedding Error:', err.message);
    return null;
  }
}

export async function storeEmbedding(supabase, messageId, embedding) {
  if (!embedding) return;
  
  const { error } = await supabase
    .from('message_embeddings')
    .insert({
      message_id: messageId,
      embedding: `[${embedding.join(',')}]`
    });
  
  if (error) {
    console.error('Store Embedding Error:', error.message);
  }
}
