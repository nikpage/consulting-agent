import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifySignature } from '../../lib/security';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const ADMIN_PIN = process.env.ADMIN_PIN;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Verify Signature
  if (!verifySignature(req.query)) return res.status(401).send('⛔ Neplatný odkaz');
  
  const { action, id, val, cp_id } = req.query;

  // 2. PIN Check (Skip if empty)
  if (ADMIN_PIN) {
    if (req.method === 'GET' && !req.query.verified) {
      // Pass parameters through to the form
      const params = new URLSearchParams(req.query as any);
      params.set('verified', 'true'); // Prevents loop after PIN check
      
      return res.send(`
        <html><body style="text-align:center; padding-top:50px; font-family:sans-serif;">
          <h2>🔐 Potvrzení Akce</h2>
          <form method="POST" action="?${params.toString()}">
            <input type="tel" name="pin" style="font-size:20px; padding:10px;" autofocus placeholder="PIN" />
            <button type="submit" style="font-size:18px; padding:10px;">Potvrdit</button>
          </form>
        </body></html>`);
    }
    if (req.method === 'POST' && req.body.pin !== ADMIN_PIN) {
      return res.send('<h1>❌ Chybný PIN</h1>');
    }
  }

  // 3. Logic Handlers
  const style = 'font-family:sans-serif; text-align:center; padding-top:20px;';

  // --- EVENTS ---
  if (action === 'confirm_event') {
     await supabase.from('events').update({ status: 'confirmed' }).eq('id', id);
     return res.send(`<h1 style="${style} color:green;">✅ Schůzka Potvrzena</h1>`);
  }
  if (action === 'reject_event') {
     await supabase.from('events').update({ status: 'cancelled' }).eq('id', id);
     return res.send(`<h1 style="${style} color:red;">❌ Schůzka Zamítnuta</h1>`);
  }

  // --- TODOS (Create) ---
  if (action === 'create_todo') {
    let date = new Date();
    let desc = 'Úkol z emailu';
    
    if (val === 'tomorrow') date.setDate(date.getDate() + 1);
    else if (val === 'later') date.setDate(date.getDate() + 5); // +5 Days
    
    // Fetch thread context for description
    const { data: thread } = await supabase.from('conversation_threads').select('topic, summary_text').eq('id', id).single();
    if (thread) desc = `Řešit: ${thread.topic}`;

    await supabase.from('todos').insert({
      user_id: 'UNKNOWN_USER_FIX_LATER', // In real app, pass user_id in params or infer
      cp_id: cp_id,
      description: desc,
      due_date: date.toISOString().split('T')[0],
      status: 'pending'
    });
    return res.send(`<h1 style="${style}">✅ Úkol vytvořen (${val === 'later' ? 'Za 5 dní' : val})</h1>`);
  }

  // --- TODOS (Manage) ---
  if (action === 'move_todo') {
    let date = new Date();
    if (val === 'tomorrow') date.setDate(date.getDate() + 1);
    else if (val === 'later') date.setDate(date.getDate() + 5);

    await supabase.from('todos').update({ due_date: date.toISOString().split('T')[0] }).eq('id', id);
    return res.send(`<h1 style="${style}">🗓️ Úkol přesunut</h1>`);
  }

  if (action === 'dismiss_todo') {
    await supabase.from('todos').update({ status: 'completed' }).eq('id', id);
    return res.send(`<h1 style="${style} color:grey;">🗑️ Úkol hotov/smazán</h1>`);
  }

  // --- LOCATIONS ---
  if (action === 'update_location') {
    if (req.method === 'GET') {
      return res.send(`
        <html><body style="${style}">
          <h2>📍 Upřesnit Místo</h2>
          <form method="POST">
            <input type="text" name="location" style="width:80%; padding:10px; font-size:16px;" placeholder="Zadejte celou adresu..." />
            <br><br>
            <button type="submit" style="padding:10px 20px; font-size:16px;">Uložit</button>
          </form>
        </body></html>
      `);
    }
    if (req.method === 'POST') {
      const loc = req.body.location;
      // Fetch existing locations
      const { data: cp } = await supabase.from('cps').select('locations').eq('id', cp_id).single();
      const newLocs = cp?.locations ? [...cp.locations, loc] : [loc];
      
      await supabase.from('cps').update({ locations: newLocs }).eq('id', cp_id);
      return res.send(`<h1 style="${style}">✅ Adresa uložena: ${loc}</h1>`);
    }
  }

  res.send('Hotovo');
}
