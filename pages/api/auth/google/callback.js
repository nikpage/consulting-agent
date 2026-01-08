import { getTokensFromCode } from '../../../../lib/google-auth'
import { supabase } from '../../../../lib/supabase'

export default async function handler(req, res) {
  const { code, state } = req.query
  if (!code || !state) return res.status(400).end()

  const tokens = await getTokensFromCode(code)

  const { data: existing } = await supabase
    .from('users')
    .select('google_oauth_tokens')
    .eq('id', state)
    .single()

  const merged = {
    ...(existing?.google_oauth_tokens || {}),
    ...tokens,
    refresh_token:
      existing?.google_oauth_tokens?.refresh_token || tokens.refresh_token
  }

  await supabase.from('users')
    .update({ google_oauth_tokens: merged })
    .eq('id', state)

  res.redirect('/admin/setup')
}
