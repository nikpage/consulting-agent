import { supabase } from '../../../lib/supabase'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // List clients
    const { data, error } = await supabase
      .from('users')
      .select('id, email, settings')
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    
    return res.status(200).json({ clients: data })
  }

  if (req.method === 'POST') {
    // Create client
    const { name, email } = req.body

    const { data, error } = await supabase
      .from('users')
      .insert({
        email: email,
        settings: { name }
      })
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    
    return res.status(201).json({ client: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
