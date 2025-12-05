import { supabase } from '../../lib/supabase'
import { ingestGmail } from '../../lib/gmail-ingest'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Get all users with tokens
    const { data: users, error } = await supabase
      .from('users')
      .select('id, google_oauth_tokens')
      .not('google_oauth_tokens', 'is', null)

    if (error) throw error

    const results = []

    for (const user of users) {
      try {
        const messages = await ingestGmail(user.id, user.google_oauth_tokens)
        results.push({
          userId: user.id,
          processed: messages.length
        })
      } catch (err) {
        console.error(`Failed to ingest for user ${user.id}:`, err)
        results.push({
          userId: user.id,
          error: err.message
        })
      }
    }

    res.status(200).json({ results })
  } catch (error) {
    console.error('Ingestion error:', error)
    res.status(500).json({ error: error.message })
  }
}
