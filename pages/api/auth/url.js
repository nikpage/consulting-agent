import { getAuthUrl } from '../../../lib/google-auth'
import { supabase } from '../../../lib/supabase'

export default async function handler(req, res) {
  const { data: user, error } = await supabase.from('users').select('id').limit(1).maybeSingle()
  if (error || !user?.id) return res.status(500).json({ error: 'No user found' })
  const url = getAuthUrl(user.id)
  res.status(200).json({ url })
}
