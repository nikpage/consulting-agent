import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

export async function classifyEmail(cleanedText, cpState) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
  
  const prompt = `Analyze this email and determine:
1. Is it Active (relevant/current) or not?
2. If Active, what is the secondary tag?

Email: "${cleanedText}"
Current CP state: ${cpState || 'unknown'}

Respond ONLY with JSON:
{
  "active": true/false,
  "tag": "event" | "todo_today" | "todo_tomorrow" | "lead" | "negotiating" | "closing" | null
}

Rules:
- "event" if scheduling/meeting mentioned
- "todo_today" if action needed today
- "todo_tomorrow" if action needed tomorrow
- "lead" if new potential client
- "negotiating" if discussing terms
- "closing" if finalizing deal`

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  return JSON.parse(text.replace(/```json\n?|\n?```/g, ''))
}

export async function updateCPSummary(cpHistory, latestMessage) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
  
  const prompt = `Update the summary for this counterparty.

Previous summary: ${cpHistory}
Latest message: ${latestMessage}

Provide a concise, structured summary (max 200 words) covering:
- Current relationship state
- Key points discussed
- Next steps if any

Respond with plain text summary only.`

  const result = await model.generateContent(prompt)
  return result.response.text()
}

export async function generateToneMatchedReply(lastFiveEmails, draftContent) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
  
  const prompt = `Analyze the tone from these emails and draft a reply matching it.

Previous emails:
${lastFiveEmails.join('\n---\n')}

Draft content to convey: ${draftContent}

Detect tone (Formal/Neutral/Friendly) and write a reply matching that tone.
Keep it concise and natural.

Respond with the email text only, no explanations.`

  const result = await model.generateContent(prompt)
  return result.response.text()
}

export async function extractEventDetails(emailText) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
  
  const prompt = `Extract meeting details from this email.

Email: "${emailText}"

Respond ONLY with JSON:
{
  "location": "address or null",
  "proposedTimes": ["ISO datetime strings"] or [],
  "constraints": "any scheduling preferences mentioned"
}

If no clear details, use null/empty arrays.`

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  return JSON.parse(text.replace(/```json\n?|\n?```/g, ''))
}
