import { google } from 'googleapis'
import { setCredentials } from './google-auth'
import { supabase } from './supabase'
import { classifyEmail } from './gemini'

export async function ingestGmail(userId, tokens) {
  const oauth2Client = setCredentials(tokens)
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  // Get messages from last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).getTime()
  
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: `after:${Math.floor(oneDayAgo / 1000)}`
  })

  if (!response.data.messages) return []

  const processed = []

  for (const msg of response.data.messages.slice(0, 50)) {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full'
    })

    const headers = full.data.payload.headers
    const from = headers.find(h => h.name === 'From')?.value || ''
    const subject = headers.find(h => h.name === 'Subject')?.value || ''
    const date = headers.find(h => h.name === 'Date')?.value || ''
    
    let body = ''
    if (full.data.payload.body.data) {
      body = Buffer.from(full.data.payload.body.data, 'base64').toString()
    } else if (full.data.payload.parts) {
      const textPart = full.data.payload.parts.find(p => p.mimeType === 'text/plain')
      if (textPart?.body.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString()
      }
    }

    // Clean text
    const cleanedText = cleanEmailText(subject + '\n' + body)
    
    // Get or create CP
    const cpEmail = extractEmail(from)
    const { data: cp } = await getOrCreateCP(userId, cpEmail, from)

    // Get CP state
    const { data: cpState } = await supabase
      .from('cp_states')
      .select('state')
      .eq('cp_id', cp.id)
      .single()

    // Classify
    const classification = await classifyEmail(cleanedText, cpState?.state)

    // Store message
    const { data: message } = await supabase
      .from('messages')
      .insert({
        user_id: userId,
        cp_id: cp.id,
        channel_id: null, // Will link to email channel
        direction: 'inbound',
        raw_text: body,
        cleaned_text: cleanedText,
        tag_primary: classification.active ? 'Active' : 'Inactive',
        tag_secondary: classification.tag,
        timestamp: new Date(date)
      })
      .select()
      .single()

    processed.push(message)
  }

  return processed
}

function cleanEmailText(text) {
  // Remove signatures, quotes, etc
  let cleaned = text
    .replace(/On .+ wrote:/g, '')
    .replace(/>{1,}.*/g, '')
    .replace(/_{5,}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  
  return cleaned.substring(0, 2000) // Limit length
}

function extractEmail(fromHeader) {
  const match = fromHeader.match(/<(.+?)>/)
  return match ? match[1] : fromHeader
}

async function getOrCreateCP(userId, email, fullName) {
  // Check if exists
  const { data: existing } = await supabase
    .from('cps')
    .select('*')
    .eq('user_id', userId)
    .eq('primary_identifier', email)
    .single()

  if (existing) return { data: existing }

  // Create new
  const name = fullName.replace(/<.+>/, '').trim() || email
  
  return await supabase
    .from('cps')
    .insert({
      user_id: userId,
      name: name,
      primary_identifier: email,
      other_identifiers: {}
    })
    .select()
    .single()
}
