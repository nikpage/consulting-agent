import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function processMessagePipeline(text, currentCpSummary) {
  if (!text) {
    return { 
      primary: 'Inactive', 
      secondary: null, 
      state: 'idle', 
      deal_type: 'buyer', // Default safe fallback
      summary: currentCpSummary || 'Žádná historie.' 
    };
  }
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const prompt = `
    Role: Asistent prodeje realit.
    Task: Analyzuj email a klasifikuj stav obchodu.
    
    Email: """${text.substring(0, 8000)}"""

    INSTRUCTIONS:
    - **deal_type**: MUST be either "buyer" (kupující) or "seller" (prodávající). If unclear, pick the most likely based on who pays whom or who owns property.
    - **state**: MUST be one of: "lead" (nový), "negotiating" (jednání), "closing" (uzavírání), "idle" (klid).

    Output JSON:
    {
      "primary": "Active" | "Inactive",
      "secondary": "event" | "todo_today" | "todo_tomorrow" | "null",
      "state": "lead" | "negotiating" | "closing" | "idle",
      "deal_type": "buyer" | "seller",
      "summary": "Ignore this field for now."
    }
  `;

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    const jsonString = raw.replace(/^```json/gm, '').replace(/^```/gm, '').trim();
    return JSON.parse(jsonString);
  } catch (err) {
    console.error('Classification Error:', err.message);
    return { primary: 'Active', secondary: null, state: 'idle', deal_type: 'buyer', summary: 'Chyba.' };
  }
}
