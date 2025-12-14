import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { signParams } from '../../lib/security';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

function makeActionUrl(action, id, extra) {
  const params = { action: action, id: id, ts: Date.now().toString(), ...extra };
  params.sig = signParams(params);
  const query = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  return BASE_URL + '/api/cmd?' + query;
}

async function getDailyData(userId) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data: todos } = await supabase
    .from('todos')
    .select('id, description, due_date, status, cps(name)')
    .eq('user_id', userId)
    .in('status', ['pending', 'in_progress'])
    .lte('due_date', todayEnd.toISOString().split('T')[0]);

  const { data: events } = await supabase
    .from('events')
    .select('id, title, start_time, end_time, location, status, cps(name)')
    .eq('user_id', userId)
    .gte('start_time', todayStart.toISOString())
    .lte('start_time', todayEnd.toISOString());

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  const { data: threads } = await supabase
    .from('conversation_threads')
    .select('id, topic, summary_text')
    .eq('user_id', userId)
    .eq('state', 'active')
    .gt('last_updated', yesterday.toISOString());

  return { todos: todos || [], events: events || [], threads: threads || [] };
}

function formatTodos(todos) {
  if (!todos.length) return '<p>Žádné úkoly.</p>';
  
  return '<ul>' + todos.map(t => {
    const desc = t.description.replace(/^ÚKOL:\s*/i, '').replace(/^TODO:\s*/i, '');
    const completeUrl = makeActionUrl('complete_todo', t.id);
    const snoozeUrl = makeActionUrl('snooze_todo', t.id);
    
    return '<li>' + desc + 
      ' <a href="' + completeUrl + '" style="color:green;">[✓ Hotovo]</a>' +
      ' <a href="' + snoozeUrl + '" style="color:orange;">[→ Zítra]</a>' +
      '</li>';
  }).join('') + '</ul>';
}

function formatEvents(events) {
  if (!events.length) return '<p>Žádné události.</p>';
  
  return '<ul>' + events.map(e => {
    const time = new Date(e.start_time).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
    const acceptUrl = makeActionUrl('accept_event', e.id);
    const rejectUrl = makeActionUrl('reject_event', e.id);
    const rescheduleUrl = makeActionUrl('reschedule_event', e.id);
    
    let buttons = '';
    if (e.status === 'suggested' || e.status === 'conflict') {
      buttons = ' <a href="' + acceptUrl + '" style="color:green;">[✓ Potvrdit]</a>' +
        ' <a href="' + rescheduleUrl + '" style="color:blue;">[⏰ Jiný čas]</a>' +
        ' <a href="' + rejectUrl + '" style="color:red;">[✗ Zrušit]</a>';
    }
    
    const conflict = e.status === 'conflict' ? ' <strong style="color:red;">[KONFLIKT]</strong>' : '';
    
    return '<li>' + e.title + ' - ' + time + ' @ ' + (e.location || 'TBD') + conflict + buttons + '</li>';
  }).join('') + '</ul>';
}

function formatThreads(threads) {
  if (!threads.length) return '<p>Žádné aktualizace.</p>';
  
  return '<ul>' + threads.map(t => {
    const topic = t.topic.replace(/^Conversation with\s*/i, '').replace(/\s*\(active\)\s*$/i, '');
    return '<li><strong>' + topic + '</strong>: ' + (t.summary_text || '').substring(0, 150) + '</li>';
  }).join('') + '</ul>';
}

async function sendEmailToSelf(gmail, email, subject, bodyHtml) {
  const utf8Subject = Buffer.from(subject).toString('base64');
  const encodedSubject = '=?UTF-8?B?' + utf8Subject + '?=';

  const fullHtml = '<div style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333;">' +
    bodyHtml +
    '<br><br><div style="font-size: 14px; color: #555;">S pozdravem,<br>Váš Výkonný Asistent Special Agent 23</div></div>';
  
  const messageParts = [
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    'To: ' + email,
    'Subject: ' + encodedSubject,
    '',
    fullHtml
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

    for (const client of clients) {
      if (!client.google_oauth_tokens) continue;

      try {
        const data = await getDailyData(client.id);
        
        const name = client.settings?.name || 'Client';
        const todayStr = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
        
        const bodyHtml = '<p>Dobrý den ' + name + ',</p>' +
          '<p>Zde je Váš přehled na ' + todayStr + ':</p>' +
          '<h3>Události</h3>' + formatEvents(data.events) +
          '<h3>Úkoly</h3>' + formatTodos(data.todos) +
          '<h3>Aktivity</h3>' + formatThreads(data.threads) +
          '<p>Přeji produktivní den!</p>';

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
    res.status(500).json({ error: fatalErr.message });
  }
}
