import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function processMessagePipeline(text, currentCpSummary) {
  if (!text) {
    return { primary: 'Inactive', secondary: null, state: 'idle', summary: currentCpSummary || 'No history.' };
  }
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const prompt = `
    Role: Sales Assistant.
    Task: Process the new email against the current deal summary.
    
    Previous Summary: "${currentCpSummary || 'No previous history.'}"
    New Email Text: """${text.substring(0, 8000)}"""

    Output a single JSON object containing four fields:
    1. primary: "Active" or "Inactive".
    2. secondary: One of ["event", "todo_today", "todo_tomorrow", "lead", "negotiating", "closing", "null"].
    3. state: One of ["lead", "negotiating", "closing", "idle"].
    4. summary: A concise update (max 3 sentences) of the Previous Summary incorporating the New Email Text.
  `;

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    const jsonString = raw.replace(/^```json/gm, '').replace(/^```/gm, '').trim();
    return JSON.parse(jsonString);
  } catch (err) {
    console.error('Unified Processing Error:', err.message);
    return { primary: 'Active', secondary: null, state: 'idle', summary: 'Error processing message.' };
  }
}
