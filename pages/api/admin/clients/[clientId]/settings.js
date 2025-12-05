import { supabase } from '../../../../lib/supabase'

export default async function handler(req, res) {
  const { clientId } = req.query

  if (req.method === 'PUT') {
    const settings = req.body

    const { data, error } = await supabase
      .from('users')
      .update({ settings })
      .eq('id', clientId)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    
    return res.status(200).json({ client: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
