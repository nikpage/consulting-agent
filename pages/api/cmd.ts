import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifySignature } from '../../lib/security';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!verifySignature(req.query)) {
    return res.status(401).send('<h1>⛔ Neplatný odkaz</h1>');
  }

  const { action, id } = req.query;

  try {
    if (action === 'complete_todo') {
      await supabase.from('todos').update({ status: 'completed' }).eq('id', id);
      return res.send('<h1>✅ Úkol dokončen</h1>');
    }

    if (action === 'snooze_todo') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await supabase.from('todos').update({ due_date: tomorrow.toISOString().split('T')[0] }).eq('id', id);
      return res.send('<h1>📅 Úkol přesunut na zítra</h1>');
    }

    if (action === 'accept_event') {
      await supabase.from('events').update({ status: 'confirmed' }).eq('id', id);
      return res.send('<h1>✅ Událost potvrzena</h1>');
    }

    if (action === 'reject_event') {
      await supabase.from('events').update({ status: 'rejected' }).eq('id', id);
      return res.send('<h1>❌ Událost zrušena</h1>');
    }

    if (action === 'reschedule_event') {
      return res.send('<h1>⏰ Navrhněte nový čas</h1><p>Tato funkce bude brzy dostupná.</p>');
    }

    res.send('<h1>❓ Neznámá akce</h1>');
  } catch (err: any) {
    res.status(500).send('<h1>❌ Chyba: ' + err.message + '</h1>');
  }
}
