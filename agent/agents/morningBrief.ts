import type { SupabaseClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { signParams } from '../../lib/security';

function makeActionUrl(action: string, id: string, extra?: any): string {
  const params: any = { action, id, ts: Date.now().toString(), ...extra };
  params.sig = signParams(params);
  const query = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  return `${process.env.NEXTAUTH_URL}/api/cmd?${query}`;
}

async function getDailyData(supabase: SupabaseClient, userId: string) {
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

  const { data: headlines } = await supabase
    .from('conversation_threads')
    .select('topic, summary_text, priority_score, cps(name)')
    .eq('user_id', userId)
    .eq('state', 'active')
    .gte('priority_score', 8)
    .order('priority_score', { ascending: false })
    .limit(3);

  const { data: threads } = await supabase
    .from('conversation_threads')
    .select('id, topic, summary_text, last_updated, cps(name)')
    .eq('user_id', userId)
    .eq('state', 'active')
    .order('last_updated', { ascending: false });

  return { todos, events, headlines, threads };
}

function formatHeadlines(headlines: any[] | null): string {
  if (!headlines || headlines.length === 0) return '<p><em>Žádné urgentní záležitosti (No Urgent Items).</em></p>';
  return '<ul style="background-color: #ffebeb; padding: 15px; border-radius: 5px; border: 1px solid #ffcccc;">' + headlines.map(h => {
    return `<li style="margin-bottom: 5px; font-size: 1.1em;"><strong>🔥 ${h.cps?.name || 'Unknown'}:</strong> ${h.summary_text}</li>`;
  }).join('') + '</ul>';
}

function formatTodos(todos: any[] | null): string {
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

function formatEvents(events: any[] | null): string {
  if (!events || events.length === 0) return '<p>Žádné události.</p>';
  return '<ul>' + events.map(e => {
    const time = new Date(e.start_time).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
    return `<li><strong>${time}</strong> - ${e.title} (${e.location || 'TBD'})</li>`;
  }).join('') + '</ul>';
}

function formatThreads(threads: any[] | null): string {
  if (!threads || threads.length === 0) return '<p>Žádná aktivita.</p>';
  return '<ul>' + threads.map(t => {
    return `<li style="margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
      <div style="font-weight: bold; color: #333;">${t.cps?.name || 'Neznámý'}</div>
      <div style="color: #000;">${t.summary_text || 'Bez shrnutí'}</div>
    </li>`;
  }).join('') + '</ul>';
}

async function sendEmailToSelf(gmail: any, email: string, subject: string, bodyHtml: string) {
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

export async function runMorningBrief(
  supabase: SupabaseClient,
  userId: string,
  email: string,
  tokens: any
): Promise<void> {
  const data = await getDailyData(supabase, userId);

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

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  await sendEmailToSelf(gmail, email, 'Denní Přehled - ' + todayStr, bodyHtml);
}
