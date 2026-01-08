import { GoogleGenerativeAI } from '@google/generative-ai';
import { AgentContext } from '../agentContext';
import { retry } from '../retryPolicy';

export async function classifyEmail(text: string, ctx: AgentContext, currentCpSummary?: string | null): Promise<any> {
  const genAI = new GoogleGenerativeAI(ctx.apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `
  ACT AS: Expert Executive Assistant.
  TASK: Triage this incoming email.

  CONTEXT (Previous): "${currentCpSummary || 'None'}"
  EMAIL: """${text.substring(0, 8000)}"""

  ANALYZE ALONG THESE 3 AXES:

  1. RELEVANCE (Choose ONE):
  - SALES: Related to property, clients, active deals, negotiations.
  - BUSINESS: Admin, invoices, operations, team syncs.
  - PERSONAL: Family, friends.
  - OPPORTUNITY: Recruiting, partnerships, unexpected networking.
  - NOISE: Spam, newsletters, automated alerts (STOP processing if this).

  2. IMPORTANCE (Choose ONE):
  - CRITICAL: Interrupt me! Deal breakers, last minute cancellations, urgent legal.
  - HIGH: I must see this today (before next meeting).
  - REGULAR: Standard correspondence.
  - LOW: FYI / Read later.

  3. TYPE (Choose ONE):
  - EVENT: Requesting a meeting or time slot.
  - TODO: Requires action/task (but not a meeting).
  - INFO: Just an update/conversation.

  EXTRACTION TASKS:
  - If EVENT: Extract duration (default 60m) and preferred times.
  - If TODO: Infer specific due date (Today/Tomorrow/Soon).
  - SUMMARY: Write a "One-Liner Action Point" in Czech (e.g. "Klient chce slevu, nutná schůzka").

  OUTPUT JSON ONLY:
  {
    "relevance": "SALES" | "BUSINESS" | "PERSONAL" | "OPPORTUNITY" | "NOISE",
    "importance": "CRITICAL" | "HIGH" | "REGULAR" | "LOW",
    "type": "EVENT" | "TODO" | "INFO",
    "summary_czech": "String",
    "event_details": { "duration_minutes": 60, "requested_time": "ISO string or null" },
    "todo_details": { "description": "String", "urgency": "TODAY" | "TOMORROW" | "SOON" }
  }
  `;

  try {
    const result = await retry(() => model.generateContent(prompt));
    const raw = result.response.text();
    const jsonString = raw.replace(/^```json/gm, '').replace(/^```/gm, '').trim();
    return JSON.parse(jsonString);
  } catch (err: any) {
    // Fail-safe: Treat as standard business info
    return { relevance: 'BUSINESS', importance: 'REGULAR', type: 'INFO', summary_czech: 'Chyba analýzy.' };
  }
}
