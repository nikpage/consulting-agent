// pages/api/run-agent.ts

import type { NextApiRequest, NextApiResponse } from 'next'

const runnerModule = require('../../agent/agentRunner')
const run =
  runnerModule.agentRunner ||
  runnerModule.default ||
  runnerModule.run ||
  runnerModule

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.status(405).end()
    return
  }

  const { clientId } = req.body as { clientId?: string }
  if (!clientId) {
    res.status(400).json({ error: 'clientId required' })
    return
  }

  await run({ clientId })

  res.status(200).json({ ok: true })
}
