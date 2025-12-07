import { getTokensFromCode } from '../../../../lib/google-auth'
import { supabase } from '../../../../lib/supabase'

export default async function handler(req, res) {
  const { code, state } = req.query

  console.log('Callback received - state:', state, 'code:', code?.substring(0, 20))

  if (!code) {
    return res.status(400).json({ error: 'No code provided' })
  }

  try {
    const tokens = await getTokensFromCode(code)
    console.log('Got tokens:', tokens ? 'yes' : 'no')
    
    const { data, error } = await supabase
      .from('users')
      .update({ google_oauth_tokens: tokens })
      .eq('id', state)
    
    console.log('Update result - data:', data, 'error:', error)
    
    res.redirect('/admin/setup')
  } catch (error) {
    console.error('OAuth callback error:', error)
    res.status(500).json({ error: error.message })
  }
}
