import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { runMorningBrief } from '../../agent/agents/morningBrief';
import { saveAgentError } from '../../lib/agentErrors';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: clients } = await supabase.from('users').select('*');
    if (!clients) return res.status(200).json({ status: 'No clients' });

    for (const client of clients) {
      if (!client.google_oauth_tokens) continue;

      // Check pause
      const settings = client.settings || {};
      if (settings.agent_paused === true) {
        console.log(`Skipping paused client: ${client.email}`);
        continue;
      }

      try {
        console.log(`Preparing Brief for ${client.email}...`);

        const tokens = typeof client.google_oauth_tokens === 'string'
          ? JSON.parse(client.google_oauth_tokens)
          : client.google_oauth_tokens;

        await runMorningBrief(supabase, client.id, client.email, tokens);
        console.log('✓ Sent to ' + client.email);

      } catch (err: any) {
        const errorId = await saveAgentError(supabase, client.id, 'morning_brief', err);
        console.error(`Error for ${client.email}: ${err.message} Error ID: ${errorId}`);
      }
    }

    res.status(200).json({ status: 'OK' });
  } catch (fatalErr: any) {
    console.error('Fatal Brief Error:', fatalErr);
    res.status(500).json({ error: fatalErr.message });
  }
}
