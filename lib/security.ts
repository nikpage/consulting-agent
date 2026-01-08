import type { NextApiRequest, NextApiResponse } from 'next';
import { runAgentForClient } from '../../agent/agentRunner';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { clientId } = req.body;

  if (!clientId) {
    return res.status(400).json({ error: 'clientId required' });
  }

  try {
    const result = await runAgentForClient(clientId);
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
