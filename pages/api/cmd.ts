import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifySignature } from '../../lib/security';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!verifySignature(req.query)) return res.status(401).send('⛔ Invalid Link');

  if (req.method === 'GET') {
    return res.send(`
      <html><body style="text-align:center; padding-top:50px;">
        <h2>🔐 Enter PIN</h2>
        <form method="POST">
          <input type="tel" name="pin" style="font-size:20px; padding:10px;" autofocus />
          <button type="submit" style="font-size:18px; padding:10px;">Go</button>
        </form>
      </body></html>`);
  }

  if (req.body.pin !== ADMIN_PIN) return res.send('<h1>❌ Wrong PIN</h1>');

  const { scope, action, id, group_id } = req.query;

  if (scope === 'conflict') {
    if (action === 'accept_option') {
       await supabase.from('events').update({ status: 'confirmed' }).or(`id.eq.${id},parent_event_id.eq.${id}`);
       await supabase.from('events').delete().eq('pre_block_group_id', group_id).neq('id', id).neq('parent_event_id', id);
       return res.send('<h1>✅ Confirmed</h1>');
    }
    if (action === 'reject_all') {
       await supabase.from('events').delete().eq('pre_block_group_id', group_id);
       return res.send('<h1>❌ Rejected</h1>');
    }
  }
  res.send('Done');
}
