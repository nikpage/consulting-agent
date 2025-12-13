import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifySignature } from '../../lib/security';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!verifySignature(req.query)) return res.status(401).send('⛔ Invalid Link');

  const { scope, action, id, group_id, val } = req.query;

  // Conflict resolution
  if (scope === 'conflict') {
    if (action === 'accept_option') {
       await supabase.from('events').update({ status: 'confirmed' }).or(`id.eq.${id},parent_event_id.eq.${id}`);
       await supabase.from('events').delete().eq('pre_block_group_id', group_id).neq('id', id).neq('parent_event_id', id);
       return res.send('<h1 style="font-family:sans-serif;text-align:center;padding-top:50px;">✅ Potvrzeno</h1>');
    }
    if (action === 'reject_all') {
       await supabase.from('events').delete().eq('pre_block_group_id', group_id);
       return res.send('<h1 style="font-family:sans-serif;text-align:center;padding-top:50px;">❌ Zamítnuto</h1>');
    }
  }

  // Event actions
  if (action === 'confirm_event') {
    await supabase.from('events').update({ status: 'confirmed' }).eq('id', id);
    return res.send('<h1 style="font-family:sans-serif;text-align:center;padding-top:50px;color:green;">✅ Schůzka potvrzena</h1>');
  }
  if (action === 'reject_event') {
    await supabase.from('events').update({ status: 'cancelled' }).eq('id', id);
    return res.send('<h1 style="font-family:sans-serif;text-align:center;padding-top:50px;color:red;">❌ Schůzka zamítnuta</h1>');
  }

  // Todo actions
  if (action === 'done_todo') {
    await supabase.from('todos').update({ status: 'completed' }).eq('id', id);
    return res.send('<h1 style="font-family:sans-serif;text-align:center;padding-top:50px;">✅ Hotovo</h1>');
  }
  if (action === 'move_todo') {
    let date = new Date();
    if (val === 'tomorrow') date.setDate(date.getDate() + 1);
    else if (val === 'later') date.setDate(date.getDate() + 5);
    await supabase.from('todos').update({ due_date: date.toISOString().split('T')[0] }).eq('id', id);
    return res.send('<h1 style="font-family:sans-serif;text-align:center;padding-top:50px;">📅 Přesunuto</h1>');
  }

  res.send('OK');
}
