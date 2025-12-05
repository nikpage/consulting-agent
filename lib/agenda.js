import { supabase } from './supabase'
import { getCalendarEvents } from './calendar'
import { google } from 'googleapis'
import { setCredentials } from './google-auth'

export async function generateMorningAgenda(userId, tokens) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  // Get today's calendar events
  const calEvents = await getCalendarEvents(tokens, today, tomorrow)

  // Get todos for today
  const { data: todos } = await supabase
    .from('todos')
    .select('*, cps(name)')
    .eq('user_id', userId)
    .eq('due_date', today.toISOString().split('T')[0])
    .order('scheduled_time')

  // Get active leads
  const { data: leads } = await supabase
    .from('cp_states')
    .select('*, cps(name)')
    .eq('state', 'lead')
    .in('cp_id', await getUserCPIds(userId))

  // Get active negotiations
  const { data: negotiations } = await supabase
    .from('cp_states')
    .select('*, cps(name)')
    .eq('state', 'negotiating')
    .in('cp_id', await getUserCPIds(userId))

  // Get active closings
  const { data: closings } = await supabase
    .from('cp_states')
    .select('*, cps(name)')
    .eq('state', 'closing')
    .in('cp_id', await getUserCPIds(userId))

  // Build agenda
  let agenda = `Good morning! Here's your agenda for ${today.toLocaleDateString()}:\n\n`

  // Meetings
  if (calEvents.length > 0) {
    agenda += `📅 TODAY'S MEETINGS:\n`
    for (const event of calEvents) {
      const start = new Date(event.start.dateTime || event.start.date)
      agenda += `  ${start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} - ${event.summary}`
      if (event.location) agenda += ` @ ${event.location}`
      agenda += `\n`
    }
    agenda += `\n`
  }

  // Todos
  if (todos && todos.length > 0) {
    agenda += `✅ TODAY'S TODOS:\n`
    for (const todo of todos) {
      agenda += `  - ${todo.description}`
      if (todo.cps) agenda += ` (${todo.cps.name})`
      agenda += `\n`
    }
    agenda += `\n`
  }

  // Leads
  if (leads && leads.length > 0) {
    agenda += `🎯 ACTIVE LEADS:\n`
    for (const lead of leads) {
      agenda += `  ${lead.cps.name}: ${lead.summary_text || 'New lead'}\n`
    }
    agenda += `\n`
  }

  // Negotiations
  if (negotiations && negotiations.length > 0) {
    agenda += `💼 NEGOTIATIONS:\n`
    for (const neg of negotiations) {
      agenda += `  ${neg.cps.name}: ${neg.summary_text || 'In progress'}\n`
    }
    agenda += `\n`
  }

  // Closings
  if (closings && closings.length > 0) {
    agenda += `🎉 CLOSING SOON:\n`
    for (const closing of closings) {
      agenda += `  ${closing.cps.name}: ${closing.summary_text || 'Ready to close'}\n`
    }
    agenda += `\n`
  }

  agenda += `Have a productive day!`

  return agenda
}

export async function sendAgendaEmail(userId, tokens, agendaText) {
  const oauth2Client = setCredentials(tokens)
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  // Get user email
  const { data: user } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .single()

  const message = [
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    `To: ${user.email}`,
    'Subject: Your Daily Agenda',
    '',
    agendaText
  ].join('\n')

  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage
    }
  })
}

async function getUserCPIds(userId) {
  const { data } = await supabase
    .from('cps')
    .select('id')
    .eq('user_id', userId)
  
  return data ? data.map(cp => cp.id) : []
}
