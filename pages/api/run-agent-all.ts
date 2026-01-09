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

  // Guard: already running
  if (isRunning) {
    return res.status(200).json({ skipped: true, reason: 'lock' });
  }

  // Guard: recent run
  const now = Date.now();
  if (now - lastRunTime < 120000) {
    return res.status(200).json({ skipped: true, reason: 'recent_run' });
  }

  // Set lock
  isRunning = true;

  let clientsAttempted = 0;
  let clientsRun = 0;
  let clientsSkipped = 0;
  const errors: string[] = [];

  try {
    // Get active clients
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .filter('settings->>agent_paused', 'neq', 'true');

    if (error) {
      errors.push(`DB query failed: ${error.message}`);
      return res.status(200).json({ clientsAttempted, clientsRun, clientsSkipped, errors });
    }

    if (!users || users.length === 0) {
      return res.status(200).json({ clientsAttempted, clientsRun, clientsSkipped, errors });
    }

    // Process each client
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
    // Release lock and update last run time
    isRunning = false;
    lastRunTime = Date.now();
  }
}
