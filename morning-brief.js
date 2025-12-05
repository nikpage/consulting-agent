import { supabase } from '../../lib/supabase'
import { generateMorningAgenda, sendAgendaEmail } from '../../lib/agenda'

export default async function handler(req, res) {
  const authHeader = req.headers.authorization
  if (authHeader !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Get all users
    const { data: users, error } = await supabase
      .from('users')
      .select('id, google_oauth_tokens')
      .not('google_oauth_tokens', 'is', null)

    if (error) throw error

    const results = []

    for (const user of users) {
      try {
        const agenda = await generateMorningAgenda(user.id, user.google_oauth_tokens)
        await sendAgendaEmail(user.id, user.google_oauth_tokens, agenda)
        
        results.push({
          userId: user.id,
          sent: true
        })
      } catch (err) {
        console.error(`Failed to send agenda for user ${user.id}:`, err)
        results.push({
          userId: user.id,
          error: err.message
        })
      }
    }

    res.status(200).json({ results })
  } catch (error) {
    console.error('Morning brief error:', error)
    res.status(500).json({ error: error.message })
  }
}
