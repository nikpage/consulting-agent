import { getAuthUrl } from '../../../lib/google-auth'

export default function handler(req, res) {
  const { state } = req.query
  if (!state) return res.status(400).send('Missing state')
  const url = getAuthUrl(state)
  return res.redirect(url)
}
