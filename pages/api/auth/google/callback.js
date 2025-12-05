import { getTokensFromCode } from '../../../lib/google-auth'

export default async function handler(req, res) {
  const { code, state } = req.query

  if (!code) {
    return res.status(400).json({ error: 'No code provided' })
  }

  try {
    const tokens = await getTokensFromCode(code)
    
    // state contains userId - store tokens
    // In production, verify state token
    
    res.redirect(`/admin/setup?tokens=${encodeURIComponent(JSON.stringify(tokens))}&userId=${state}`)
  } catch (error) {
    console.error('OAuth callback error:', error)
    res.status(500).json({ error: error.message })
  }
}
