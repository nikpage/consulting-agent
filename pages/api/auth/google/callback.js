import { getTokensFromCode } from '../../../../lib/google-auth'
import { supabase } from '../../../../lib/supabase'

export default async function handler(req, res) {
  const { code, state } = req.query
  if (!code) return res.status(400).json({ error: 'No code provided' })

  try {
    const newTokens = await getTokensFromCode(code)

    const { data: existing } = await supabase
      .from('users')
      .select('google_oauth_tokens')
      .eq('id', state)
      .maybeSingle()

    const oldTokens = (typeof existing?.google_oauth_tokens === 'string')
      ? JSON.parse(existing.google_oauth_tokens)
      : existing?.google_oauth_tokens

    if (!newTokens.refresh_token && oldTokens?.refresh_token) {
      newTokens.refresh_token = oldTokens.refresh_token
    }

    await supabase.from('users').update({ google_oauth_tokens: newTokens }).eq('id', state)
    return res.redirect('/admin/setup')
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
