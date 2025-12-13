import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { signParams } from '../../lib/security';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

function makeLink(action, id, label, extra = {}) {
  const params = { action, id, t: Date.now().toString(), ...extra };
  const sig = signParams(params);
  const query = new URLSearchParams({ ...params, sig }).toString();
  return `<a href="${BASE_URL}/api/cmd?${query}" style="color:#1565C0;text-decoration:none;font-size:12px;border:1px solid #1565C0;padding:3px 8px;border-radius:4px;margin-right:5px;">${label}</a>`;
}

async function getDailyData(userId, userEmail) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

  // Todos
  const { data: todos } = await supabase
    .from('todos')
    .select('*, cps(name, primary_identifier)')
    .eq('user_id', userId)
    .in('status', ['pending', 'in_progress'])
    .order('due_date');

  // Events needing confirmation
  const { data: pendingEvents } = await supabase
    .from('events')
    .select('*, cps(name)')
    .eq('user_id', userId)
    .eq('status', 'suggested');

  // Today's confirmed events
  const { data: todayEvents } = await supabase
    .from('events')
    .select('*')
    .eq('user_id', userId)
    .gte('start_time', todayStart.toISOString())
    .lte('start_time', todayEnd.toISOString())
    .in('status', ['confirmed', 'scheduled']);

  // Active threads with CPs
  const { data: threads } = await supabase
    .from('conversation_threads')
    .select('*, thread_participants(cps(id, name, primary_identifier))')
    .eq('user_id', userId)
    .neq('state', 'idle')
    .order('last_updated', { ascending: false })
    .limit(15);

  // Filter out user's own email from threads
  const userEmailLower = userEmail?.toLowerCase() || '';
  const filteredThreads = (threads || []).filter(t => {
    const cp = t.thread_participants?.[0]?.cps;
    const cpEmail = cp?.primary_identifier?.toLowerCase() || '';
    return !cpEmail.includes(userEmailLower) && !userEmailLower.includes(cpEmail.split('@')[0]);
  });

  // Mark cold ones
  const now = new Date();
  for (const t of filteredThreads) {
    t.daysSinceUpdate = Math.floor((now - new Date(t.last_updated)) / (1000*60*60*24));
    t.isCold = t.daysSinceUpdate >= 5;
  }

  return {
    todos: todos || [],
    pendingEvents: pendingEvents || [],
    todayEvents: todayEvents || [],
    threads: filteredThreads
  };
}

function generateBriefHtml(data, clientName) {
  let html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;max-width:600px;margin:0 auto;color:#333;">`;
  html += `<h2 style="color:#1a5f7a;margin-bottom:20px;">Dobrý den, ${clientName}</h2>`;

  // Pending events to confirm
  if (data.pendingEvents.length > 0) {
    html += `<div style="background:#FFF3E0;padding:12px;border-radius:6px;margin-bottom:20px;">`;
    html += `<strong style="color:#E65100;">⚡ K potvrzení:</strong><br>`;
    for (const e of data.pendingEvents) {
      const time = new Date(e.start_time).toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'});
      const date = new Date(e.start_time).toLocaleDateString('cs-CZ', {day:'numeric', month:'numeric'});
      html += `<div style="margin:8px 0;">`;
      html += `<strong>${date} ${time}</strong> - ${e.title}`;
      if (e.cps?.name) html += ` (${e.cps.name})`;
      html += `<br>${makeLink('confirm_event', e.id, '✓ Potvrdit')} ${makeLink('reject_event', e.id, '✗ Zrušit')}`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  // Today's schedule
  html += `<div style="margin-bottom:20px;">`;
  html += `<strong style="color:#1a5f7a;">📅 Dnes:</strong><br>`;
  if (data.todayEvents.length > 0) {
    for (const e of data.todayEvents) {
      const time = new Date(e.start_time).toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'});
      html += `<div style="margin:6px 0;"><strong>${time}</strong> - ${e.title}`;
      if (e.location) html += ` <span style="color:#666;">(${e.location})</span>`;
      html += `</div>`;
    }
  } else {
    html += `<div style="color:#777;">Žádné schůzky</div>`;
  }
  html += `</div>`;

  // Active deals
  const activeThreads = data.threads.filter(t => !t.isCold);
  if (activeThreads.length > 0) {
    html += `<div style="margin-bottom:20px;">`;
    html += `<strong style="color:#1a5f7a;">💼 Aktivní:</strong>`;
    for (const t of activeThreads) {
      const cp = t.thread_participants?.[0]?.cps;
      const name = cp?.name || cp?.primary_identifier?.split('@')[0] || 'Neznámý';
      html += `<div style="margin:8px 0;padding:10px;background:#f5f5f5;border-radius:4px;">`;
      html += `<strong>${name}</strong>`;
      if (t.summary_text) {
        html += `<br><span style="color:#555;">${t.summary_text}</span>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  // Cold contacts
  const coldThreads = data.threads.filter(t => t.isCold);
  if (coldThreads.length > 0) {
    html += `<div style="margin-bottom:20px;">`;
    html += `<strong style="color:#D32F2F;">🥶 Chladnou:</strong>`;
    for (const t of coldThreads) {
      const cp = t.thread_participants?.[0]?.cps;
      const name = cp?.name || cp?.primary_identifier?.split('@')[0] || 'Neznámý';
      html += `<div style="margin:6px 0;padding:8px;background:#ffebee;border-radius:4px;">`;
      html += `<strong>${name}</strong> <span style="color:#666;">(${t.daysSinceUpdate} dní)</span>`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  // Todos
  const pendingTodos = data.todos.filter(t => t.status !== 'completed');
  if (pendingTodos.length > 0) {
    html += `<div style="margin-bottom:20px;">`;
    html += `<strong style="color:#1a5f7a;">✅ Úkoly:</strong>`;
    for (const t of pendingTodos) {
      const cpName = t.cps?.name || '';
      const isOverdue = t.due_date && new Date(t.due_date) < new Date();
      html += `<div style="margin:8px 0;${isOverdue ? 'color:#c00;' : ''}">`;
      html += `• ${t.description}`;
      if (cpName) html += ` <span style="color:#666;">(${cpName})</span>`;
      if (t.due_date) html += ` <span style="font-size:12px;color:#888;">[${t.due_date}]</span>`;
      html += `<br><div style="margin-top:4px;">`;
      html += `${makeLink('done_todo', t.id, 'Hotovo')} `;
      html += `${makeLink('move_todo', t.id, 'Zítra', {val:'tomorrow'})} `;
      html += `${makeLink('move_todo', t.id, 'Později', {val:'later'})}`;
      html += `</div></div>`;
    }
    html += `</div>`;
  }

  html += `<div style="margin-top:30px;padding-top:15px;border-top:1px solid #ddd;color:#666;font-size:13px;">`;
  html += `S pozdravem,<br>Váš asistent`;
  html += `</div></div>`;

  return html;
}

async function sendEmail(gmail, email, subject, bodyHtml) {
  const utf8Subject = Buffer.from(subject).toString('base64');
  const encodedSubject = `=?UTF-8?B?${utf8Subject}?=`;

  const messageParts = [
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    'To: ' + email,
    `Subject: ${encodedSubject}`,
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

    for (const client of clients) {
      if (!client.google_oauth_tokens) continue;

      try {
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

        const dbData = await getDailyData(client.id, client.email);
        const html = generateBriefHtml(dbData, client.settings?.name || 'Agent');
        const subject = `⚡ Brief: ${new Date().toLocaleDateString('cs-CZ')}`;

        await sendEmail(gmail, client.email, subject, html);
        console.log(`✓ Sent to ${client.email}`);
      } catch (err) {
        console.error(`Error for ${client.email}:`, err.message);
      }
    }

    res.status(200).json({ status: 'OK' });
  } catch (err) {
    console.error('Fatal:', err.message);
    res.status(500).json({ error: err.message });
  }
}
