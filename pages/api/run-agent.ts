import type { NextApiRequest, NextApiResponse } from 'next'
import { runAgentForClient } from '../../agent/agentRunner'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.status(405).end()
    return
  }

  const { clientId } = req.body
  if (!clientId) {
    res.status(400).json({ error: 'clientId required' })
    return
  }

  const result = await runAgentForClient(clientId)
  res.status(200).json(result)
}
