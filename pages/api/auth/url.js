import { getAuthUrl } from '../../../lib/google-auth'

export default function handler(req, res) {
  const url = getAuthUrl()
  res.status(200).json({ url })
}
