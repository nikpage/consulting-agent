import { Buffer } from 'buffer';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { getOAuth2Client } from '../../lib/google-auth';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

async function getCalendarEvents(oauth2Client, startDate, endDate) {
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime'
  });
  return res.data.items || [];
}

function findCalendarConflicts(events) {
  const conflicts = [];
  const sorted = events
    .filter(e => e.start.dateTime)
    .sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const currentEnd = new Date(current.end.dateTime);
    const nextStart = new Date(next.start.dateTime);

    if (currentEnd > nextStart) {
      const conflictTime = new Date(next.start.dateTime);
      const existing = conflicts.find(c => Math.abs(c.time - conflictTime) < 60000);

      if (existing) {
        if (!existing.events.find(e => e.name === next.summary)) {
          existing.events.push({ name: next.summary, location: next.location });
        }
      } else {
        conflicts.push({
          date: conflictTime,
          time: conflictTime,
          events: [
            { name: current.summary, location: current.location },
            { name: next.summary, location: next.location }
          ]
        });
      }
    }
  }
  return conflicts;
}

function isToday(date) {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

async function getDailyData(userId, oauth2Client) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const tomorrowEnd = new Date(todayEnd);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

  // 5 working days from now
  const fiveWorkingDays = new Date(now);
  let daysAdded = 0;
  while (daysAdded < 5) {
    fiveWorkingDays.setDate(fiveWorkingDays.getDate() + 1);
    const day = fiveWorkingDays.getDay();
    if (day !== 0 && day !== 6) daysAdded++;
  }

  // 30 days from now
  const thirtyDays = new Date(now);
  thirtyDays.setDate(thirtyDays.getDate() + 30);

  // Today's todos
  const { data: todayTodos } = await supabase
    .from('todos')
    .select('*, cps(name)')
    .eq('user_id', userId)
    .in('status', ['pending', 'in_progress'])
    .eq('due_date', todayStart.toISOString().split('T')[0]);

  // Tomorrow's todos
  const { data: tomorrowTodos } = await supabase
    .from('todos')
    .select('*, cps(name)')
    .eq('user_id', userId)
    .in('status', ['pending', 'in_progress'])
    .eq('due_date', tomorrowStart.toISOString().split('T')[0]);

  // Calendar events
  const todayCalEvents = await getCalendarEvents(oauth2Client, todayStart, todayEnd);
  const calEvents5Days = await getCalendarEvents(oauth2Client, tomorrowStart, fiveWorkingDays);
  const calEvents30Days = await getCalendarEvents(oauth2Client, fiveWorkingDays, thirtyDays);

  const todayConflicts = findCalendarConflicts(todayCalEvents);
  const conflicts5Days = findCalendarConflicts(calEvents5Days);
  const conflicts30Days = findCalendarConflicts(calEvents30Days);

  // Mark today's events that are in conflict
  const conflictTimes = todayConflicts.map(c => c.time.getTime());
  const todayEventsWithConflict = todayCalEvents
    .filter(e => e.start.dateTime)
    .map(e => {
      const startTime = new Date(e.start.dateTime).getTime();
      const isConflict = conflictTimes.some(ct => Math.abs(ct - startTime) < 3600000);
      return { ...e, isConflict };
    });

  // Event changes since last brief (last 24h)
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const { data: eventChanges } = await supabase
    .from('events')
    .select('*, cps(name)')
    .eq('user_id', userId)
    .gt('created_at', yesterday.toISOString());

  // Conversation threads with participants
  const { data: threads } = await supabase
    .from('conversation_threads')
    .select('id, topic, state, summary_text, last_updated')
    .eq('user_id', userId)
    .gt('last_updated', yesterday.toISOString())
    .order('last_updated', { ascending: false });

  const threadIds = (threads || []).map(t => t.id);
  const { data: participants } = await supabase
    .from('thread_participants')
    .select('thread_id, cp_id, cps(name)')
    .in('thread_id', threadIds.length > 0 ? threadIds : ['00000000-0000-0000-0000-000000000000']);

  const threadsWithCPs = (threads || []).map(t => {
    const ps = (participants || []).filter(p => p.thread_id === t.id);
    const cpNames = ps.map(p => p.cps?.name).filter(Boolean);
    return { ...t, cpNames };
  });

  return {
    todayTodos: todayTodos || [],
    tomorrowTodos: tomorrowTodos || [],
    todayEvents: todayEventsWithConflict,
    conflicts5Days,
    conflicts30Days,
    eventChanges: eventChanges || [],
    threads: threadsWithCPs
  };
}

function formatTime(dateOrString) {
  const d = typeof dateOrString === 'string' ? new Date(dateOrString) : dateOrString;
  return d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateOrString) {
  const d = typeof dateOrString === 'string' ? new Date(dateOrString) : dateOrString;
  return d.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

function extractTopic(thread) {
  let topic = thread.topic || '';
  topic = topic.replace(/^Conversation with .+$/i, '').trim();

  if (!topic && thread.summary_text) {
    const words = thread.summary_text.split(/\s+/).slice(0, 5).join(' ');
    topic = words + '...';
  }

  return topic || 'Komunikace';
}

function groupThreadsByTopic(threads) {
  const grouped = [];

  for (const t of threads) {
    const cpName = t.cpNames?.join(', ') || 'Neznámý';
    const topic = extractTopic(t);
    const summary = t.summary_text || 'Bez shrnutí';

    const existing = grouped.find(g => g.cpName === cpName && g.topic === topic);
    if (existing) {
      existing.summaries.push(summary);
    } else {
      grouped.push({ cpName, topic, summaries: [summary] });
    }
  }

  return grouped;
}

function generateBriefHtml(data, clientName) {
  let html = `<h1 style="color:#1a5f7a;">Dobrý den, ${clientName}</h1>`;
  html += `<p style="font-size:18px;"><strong>Váš přehled na ${formatDate(new Date())}</strong></p>`;

  // === KEY HIGHLIGHTS ===
  html += `<h2 style="color:#1a5f7a;border-bottom:2px solid #1a5f7a;">🔑 Klíčové body</h2>`;

  let highlights = [];

  // Specific event changes
  if (data.eventChanges.length > 0) {
    for (const e of data.eventChanges) {
      const cp = e.cps?.name || '';
      highlights.push(`📅 <strong>${e.title}</strong>${cp ? ' (' + cp + ')' : ''} - ${formatDate(e.start_time)} ${formatTime(e.start_time)}`);
    }
  }

  // Specific conflicts today
  if (data.todayEvents.filter(e => e.isConflict).length > 0) {
    highlights.push(`🔴 <strong>Dnes máte konflikty v kalendáři!</strong> Viz agenda níže.`);
  }

  // Urgent communications
  const urgentThreads = data.threads.filter(t => t.state === 'closing' || t.state === 'negotiating');
  for (const t of urgentThreads.slice(0, 3)) {
    const cp = t.cpNames?.join(', ') || '';
    highlights.push(`💬 <strong>${cp}</strong>: ${t.state === 'closing' ? 'Blízko uzavření' : 'Probíhá jednání'}`);
  }

  if (highlights.length === 0) {
    highlights.push('✅ Žádné urgentní záležitosti.');
  }

  html += `<ul>${highlights.map(h => `<li>${h}</li>`).join('')}</ul>`;

  // === TODAY'S AGENDA (with conflicts flagged) ===
  html += `<h2 style="color:#1a5f7a;border-bottom:2px solid #1a5f7a;">📅 Dnešní agenda</h2>`;

  if (data.todayEvents.length > 0) {
    html += `<table style="width:100%;border-collapse:collapse;font-size:14px;">`;
    html += `<tr style="background:#f0f0f0;"><th style="text-align:left;padding:8px;">Čas</th><th style="text-align:left;padding:8px;">Schůzka</th><th style="text-align:left;padding:8px;">Místo</th></tr>`;
    for (const e of data.todayEvents) {
      const rowStyle = e.isConflict
        ? 'border-bottom:1px solid #ddd;background:#fee;color:#c00;'
        : 'border-bottom:1px solid #ddd;';
      const conflictFlag = e.isConflict ? ' ⚠️' : '';
      html += `<tr style="${rowStyle}">`;
      html += `<td style="padding:8px;">${formatTime(e.start.dateTime)}${conflictFlag}</td>`;
      html += `<td style="padding:8px;">${e.summary || '-'}</td>`;
      html += `<td style="padding:8px;">${e.location || '-'}</td>`;
      html += `</tr>`;
    }
    html += `</table>`;
  } else {
    html += `<p>Žádné schůzky na dnes.</p>`;
  }

  // === NEXT 4 DAYS CONFLICTS (only if any) ===
  if (data.conflicts5Days.length > 0) {
    html += `<h3 style="color:#c00;">⚠️ Konflikty - příští 4 dny</h3>`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:14px;">`;
    html += `<tr style="background:#fee;"><th style="text-align:left;padding:8px;">Datum</th><th style="text-align:left;padding:8px;">Čas</th><th style="text-align:left;padding:8px;">Kolidující schůzky</th></tr>`;
    for (const c of data.conflicts5Days) {
      html += `<tr style="border-bottom:1px solid #ddd;">`;
      html += `<td style="padding:8px;">${formatDate(c.date)}</td>`;
      html += `<td style="padding:8px;">${formatTime(c.time)}</td>`;
      html += `<td style="padding:8px;"><ul style="margin:0;padding-left:20px;">${c.events.map(e => `<li>${e.name}${e.location ? ' @ ' + e.location : ''}</li>`).join('')}</ul></td>`;
      html += `</tr>`;
    }
    html += `</table>`;
  }

  // === NEXT 25 DAYS CONFLICTS (only if any) ===
  if (data.conflicts30Days.length > 0) {
    html += `<h3 style="color:#c00;">⚠️ Konflikty - příštích 25 dní</h3>`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:14px;">`;
    html += `<tr style="background:#fee;"><th style="text-align:left;padding:8px;">Datum</th><th style="text-align:left;padding:8px;">Čas</th><th style="text-align:left;padding:8px;">Kolidující schůzky</th></tr>`;
    for (const c of data.conflicts30Days) {
      html += `<tr style="border-bottom:1px solid #ddd;">`;
      html += `<td style="padding:8px;">${formatDate(c.date)}</td>`;
      html += `<td style="padding:8px;">${formatTime(c.time)}</td>`;
      html += `<td style="padding:8px;"><ul style="margin:0;padding-left:20px;">${c.events.map(e => `<li>${e.name}${e.location ? ' @ ' + e.location : ''}</li>`).join('')}</ul></td>`;
      html += `</tr>`;
    }
    html += `</table>`;
  }

  // === TODAY'S TODOS ===
  if (data.todayTodos.length > 0) {
    html += `<h2 style="color:#1a5f7a;border-bottom:2px solid #1a5f7a;">✅ Dnešní úkoly</h2>`;
    html += `<ul>`;
    for (const t of data.todayTodos) {
      const cp = t.cps?.name ? ` (${t.cps.name})` : '';
      html += `<li>${t.description}${cp}</li>`;
    }
    html += `</ul>`;
  }

  // === TOMORROW'S TODOS ===
  if (data.tomorrowTodos.length > 0) {
    html += `<h2 style="color:#1a5f7a;border-bottom:2px solid #1a5f7a;">📋 Zítřejší úkoly</h2>`;
    html += `<ul>`;
    for (const t of data.tomorrowTodos) {
      const cp = t.cps?.name ? ` (${t.cps.name})` : '';
      html += `<li>${t.description}${cp}</li>`;
    }
    html += `</ul>`;
  }

  // === COMMUNICATIONS BRIEF ===
  const grouped = groupThreadsByTopic(data.threads);

  if (grouped.length > 0) {
    html += `<h2 style="color:#1a5f7a;border-bottom:2px solid #1a5f7a;">💬 Komunikace</h2>`;
    for (const g of grouped) {
      html += `<p style="margin-bottom:5px;"><strong>${g.cpName} - ${g.topic}:</strong></p>`;
      html += `<ul style="margin-top:0;">`;
      for (const s of g.summaries) {
        html += `<li>${s}</li>`;
      }
      html += `</ul>`;
    }
  }

  html += `<p style="margin-top:30px;">Hezký den,<br><strong>Váš Výkonný Asistent Special Agent 23</strong></p>`;

  return html;
}

async function sendEmailToSelf(gmail, email, subject, bodyHtml) {
  const utf8Subject = Buffer.from(subject).toString('base64');
  const encodedSubject = `=?UTF-8?B?${utf8Subject}?=`;

  const fullHtml = `<div style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333;">${bodyHtml}</div>`;

  const messageParts = [
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    'To: ' + email,
    `Subject: ${encodedSubject}`,
    'Importance: High',
    'X-Priority: 1',
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
    requestBody: {
      raw: encodedMessage,
      labelIds: ["STARRED", "IMPORTANT", "INBOX"]
    }
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: clients, error } = await supabase.from('users').select('*');
    if (error) throw error;

    for (const client of clients) {
      if (!client.google_oauth_tokens) continue;

      try {
        const tokens = typeof client.google_oauth_tokens === 'string'
          ? JSON.parse(client.google_oauth_tokens)
          : client.google_oauth_tokens;

        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials(tokens);

        const dbData = await getDailyData(client.id, oauth2Client);
        const briefBody = generateBriefHtml(dbData, client.settings?.name || 'Client');
        const subject = 'Denní Přehled od vašeho Special Agent 23';

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        await sendEmailToSelf(gmail, client.email, subject, briefBody);
        console.log(`✓ Sent to ${client.email}`);
      } catch (err) {
        console.error(`Error for ${client.email}:`, err.message);
      }
    }

    res.status(200).json({ status: 'OK' });

  } catch (fatalErr) {
    console.error('Fatal Error:', fatalErr.message);
    res.status(500).json({ error: fatalErr.message });
  }
}
