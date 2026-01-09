import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../lib/supabase';
import { runAgentForClient } from '../../agent/agentRunner';

let isRunning = false;
let lastRunTime = 0;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isRunning) {
    return res.status(200).json({ skipped: true, reason: 'lock' });
  }

  const now = Date.now();
  if (now - lastRunTime < 120000) {
    return res.status(200).json({ skipped: true, reason: 'recent_run' });
  }

  isRunning = true;

  let clientsAttempted = 0;
  let clientsRun = 0;
  let clientsSkipped = 0;
  const errors: string[] = [];

  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('*');

    if (error) {
      errors.push(`DB query failed: ${error.message}`);
      return res.status(200).json({ clientsAttempted, clientsRun, clientsSkipped, errors });
    }

    if (!users || users.length === 0) {
      return res.status(200).json({ clientsAttempted, clientsRun, clientsSkipped, errors });
    }

    for (const user of users) {
      clientsAttempted++;
      try {
        const result = await runAgentForClient(user.id);
        if (result.errors.length > 0) {
          clientsSkipped++;
          errors.push(...result.errors);
        } else {
          clientsRun++;
        }
      } catch (err: any) {
        clientsSkipped++;
        errors.push(`Client ${user.id}: ${err.message}`);
      }
    }

    return res.status(200).json({ clientsAttempted, clientsRun, clientsSkipped, errors });

  } finally {
    isRunning = false;
    lastRunTime = Date.now();
  }
}
