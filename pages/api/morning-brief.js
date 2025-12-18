import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { signParams } from '../../lib/security';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

function makeActionUrl(action, id, extra) {
  const params = { action: action, id: id, ts: Date.now().toString(), ...extra };
  params.sig = signParams(params);
  const query = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  return `${process.env.NEXTAUTH_URL}/api/cmd?${query}`;
}

async function getDailyData(userId) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  // Todos (Pending or In Progress, Due today or earlier)
  const { data: todos } = await supabase
    .from('todos')
    .select('id, description, due_date, status, cps(name)')
    .eq('user_id', userId)
    .in('status', ['pending', 'in_progress'])
    .lte('due_date', todayEnd.toISOString().split('T')[0]);

  // Events (Today)
  const { data: events } = await supabase
    .from('events')
    .select('id, title, start_time, end_time, location, status, cps(name)')
    .eq('user_id', userId)
    .gte('start_time', todayStart.toISOString())
    .lte('start_time', todayEnd.toISOString());

  // HEADLINES (Priority >= 8)
  const { data: headlines } = await supabase
    .from('conversation_threads')
    .select('topic, summary_text, priority_score, cps(name)')
    .eq('user_id', userId)
    .eq('state', 'active')
    .gte('priority_score', 8) 
    .order('priority_score', { ascending: false })
    .limit(3);

  // ALL ACTIVE THREADS (For Aktivity)
  const { data: threads } = await supabase
    .from('conversation_threads')
    .select('id, topic, summary_text, last_updated, cps(name)')
    .eq('user_id', userId)
    .eq('state', 'active')
    .order('last_updated', { ascending: false });

  return { todos, events, headlines, threads };
}

function formatHeadlines(headlines) {
  if (!headlines || headlines.length === 0) return '<p><em>Žádné urgentní záležitosti (No Urgent Items).</em></p>';
  return '<ul style="background-color: #ffebeb; padding: 15px; border-radius: 5px; border: 1px solid #ffcccc;">' + headlines.map(h => {
    return `<li style="margin-bottom: 5px; font-size: 1.1em;"><strong>🔥 ${h.cps?.name || 'Unknown'}:</strong> ${h.summary_text}</li>`;
  }).join('') + '</ul>';
}

function formatTodos(todos) {
  if (!todos || todos.length === 0) return '<p>Žádné úkoly.</p>';
  return '<ul>' + todos.map(t => {
    const desc = t.description.replace(/^ÚKOL:\s*/i, '').replace(/^TODO:\s*/i, '');
    const completeUrl = makeActionUrl('complete_todo', t.id);
    return `<li>
      <strong>${t.cps?.name || 'Obecné'}:</strong> ${desc}
      <br>[<a href="${completeUrl}">Hotovo</a>]
    </li>`;
  }).join('') + '</ul>';
}

function formatEvents(events) {
  if (!events || events.length === 0) return '<p>Žádné události.</p>';
  return '<ul>' + events.map(e => {
    const time = new Date(e.start_time).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
    return `<li><strong>${time}</strong> - ${e.title} (${e.location || 'TBD'})</li>`;
  }).join('') + '</ul>';
}

function formatThreads(threads) {
  if (!threads || threads.length === 0) return '<p>Žádná aktivita.</p>';
  return '<ul>' + threads.map(t => {
    // Strategic summary
    return `<li style="margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
      <div style="font-weight: bold; color: #333;">${t.cps?.name || 'Neznámý'}</div>
      <div style="color: #000;">${t.summary_text || 'Bez shrnutí'}</div>
    </li>`;
  }).join('') + '</ul>';
}

async function sendEmailToSelf(gmail, email, subject, bodyHtml) {
  const utf8Subject = Buffer.from(subject).toString('base64');
  const messageParts = [
    `From: <${email}>`,
    `To: <${email}>`,
    `Subject: =?utf-8?B?${utf8Subject}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    bodyHtml
  ].join('\n');

  const encodedMessage = Buffer.from(messageParts)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage }
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: clients } = await supabase.from('users').select('*');
    if (!clients) return res.status(200).json({ status: 'No clients' });

    for (const client of clients) {
      if (!client.google_oauth_tokens) continue;
      
      try {
        console.log(`Preparing Brief for ${client.email}...`);
        
        // 1. Get Data
        const data = await getDailyData(client.id);
        
        // 2. Format HTML
        const todayStr = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
        
        const bodyHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">☀️ Ranní Přehled: ${todayStr}</h1>
            
            <h2 style="color: #e74c3c; margin-top: 30px;">🚨 Hlavní zprávy (Headlines)</h2>
            ${formatHeadlines(data.headlines)}
            
            <h2 style="color: #2980b9; margin-top: 30px;">📅 Dnešní Kalendář</h2>
            ${formatEvents(data.events)}
            
            <h2 style="color: #27ae60; margin-top: 30px;">✅ Úkoly (To-Do)</h2>
            ${formatTodos(data.todos)}
            
            <h2 style="color: #8e44ad; margin-top: 30px;">💬 Přehled Aktivit</h2>
            ${formatThreads(data.threads)}
            
            <div style="margin-top: 50px; font-size: 0.8em; color: #999; text-align: center;">
              Vygenerováno AI Asistentem
            </div>
          </div>
        `;

        // 3. Send Email
        const tokens = typeof client.google_oauth_tokens === 'string' 
          ? JSON.parse(client.google_oauth_tokens) 
          : client.google_oauth_tokens;
        
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials(tokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        
        await sendEmailToSelf(gmail, client.email, 'Denní Přehled - ' + todayStr, bodyHtml);
        console.log('✓ Sent to ' + client.email);
        
      } catch (err) {
        console.error('Error for ' + client.email + ':', err.message);
      }
    }

    res.status(200).json({ status: 'OK' });
  } catch (fatalErr) {
    console.error('Fatal Brief Error:', fatalErr);
    res.status(500).json({ error: fatalErr.message });
  }
}
