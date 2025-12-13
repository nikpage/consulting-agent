import { Buffer } from 'buffer';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { getOAuth2Client } from '../../lib/google-auth';
import { signParams } from '../../lib/security';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

// --- HELPERS ---
function genLink(action, id, label, color, extra = {}) {
  const params = { action, id, t: Date.now().toString(), ...extra };
  const sig = signParams(params);
  const query = new URLSearchParams({ ...params, sig }).toString();
  return `<a href="${BASE_URL}/api/cmd?${query}" style="color:${color};text-decoration:none;font-size:12px;border:1px solid ${color};padding:2px 6px;border-radius:4px;margin-right:5px;">${label}</a>`;
}

async function getDailyData(userId, oauth2Client) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Fetch Data
  const { data: todos } = await supabase.from('todos').select('*, cps(name)').eq('user_id', userId).in('status', ['pending']).order('due_date');
  const { data: threads } = await supabase.from('conversation_threads').select('*, thread_participants(cp_id)').eq('user_id', userId).order('priority_score', { ascending: false });
  const { data: suggested } = await supabase.from('events').select('*').eq('user_id', userId).eq('status', 'suggested');
  
  // Calendar
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const eventsRes = await calendar.events.list({ calendarId: 'primary', timeMin: now.toISOString(), timeMax: new Date(now.getTime() + 86400000).toISOString(), singleEvents: true, orderBy: 'startTime' });

  return { todos, threads, suggested, calendar: eventsRes.data.items || [] };
}

// --- GENERATOR ---
function generateHtml(data, clientName) {
  let html = `<div style="font-family:Arial,sans-serif; max-width:600px; margin:0 auto;">`;
  html += `<h2 style="color:#333;">Dobrý den, ${clientName}</h2>`;

  // 1. SUGGESTED EVENTS (Confirmation Required)
  if (data.suggested?.length) {
    html += `<div style="background:#FFF3E0; padding:10px; border-radius:5px; margin-bottom:20px;">
      <h3 style="margin:0 0 10px; color:#E65100;">⚡ Potvrdit Schůzky</h3>`;
    for (const e of data.suggested) {
      html += `<div style="margin-bottom:10px; padding-bottom:5px; border-bottom:1px dashed #ccc;">
        <strong>${new Date(e.start_time).toLocaleTimeString('cs-CZ', {hour:'2-digit',minute:'2-digit'})}</strong> ${e.title}<br>
        ${genLink('confirm_event', e.id, '✅ ANO', 'green')} 
        ${genLink('reject_event', e.id, '❌ NE', 'red')}
      </div>`;
    }
    html += `</div>`;
  }

  // 2. DEAL PULSE (Threads)
  html += `<h3 style="border-bottom:2px solid #1a5f7a; color:#1a5f7a;">💬 Aktivita Obchodů</h3>`;
  for (const t of data.threads) {
    if (t.priority_score < 2 && t.state === 'idle') continue; // Skip low priority

    // Tags
    const dealColor = t.deal_type === 'seller' ? '#F57C00' : '#388E3C'; // Orange vs Green
    const dealLabel = t.deal_type === 'seller' ? 'PRODEJCE' : 'KUPUJÍCÍ';
    
    let stateColor = '#9E9E9E';
    let stateLabel = 'LEAD';
    if (t.state === 'negotiating') { stateColor = '#7B1FA2'; stateLabel = 'JEDNÁNÍ'; }
    if (t.state === 'closing') { stateColor = '#D32F2F'; stateLabel = 'UZAVÍRÁNÍ'; }

    const cpId = t.thread_participants?.[0]?.cp_id;

    html += `<div style="margin-bottom:15px;">
      <span style="background:${dealColor};color:fff;padding:2px 5px;font-size:10px;font-weight:bold;border-radius:3px;">${dealLabel}</span>
      <span style="background:${stateColor};color:fff;padding:2px 5px;font-size:10px;font-weight:bold;border-radius:3px;">${stateLabel}</span>
      <strong> ${t.topic}</strong>
      <p style="margin:5px 0; color:#555; font-size:14px;">${t.summary_text}</p>
      
      <div style="margin-top:5px;">
        <span style="font-size:11px;color:#777;margin-right:5px;">Vytvořit úkol:</span>
        ${genLink('create_todo', t.id, 'Dnes', '#1565C0', {val:'today', cp_id: cpId})}
        ${genLink('create_todo', t.id, 'Zítra', '#1565C0', {val:'tomorrow', cp_id: cpId})}
        ${genLink('create_todo', t.id, 'Později (5 dní)', '#1565C0', {val:'later', cp_id: cpId})}
      </div>
    </div>`;
  }

  // 3. AGENDA (Events)
  html += `<h3 style="border-bottom:2px solid #1a5f7a; color:#1a5f7a; margin-top:25px;">📅 Agenda Dnes</h3>`;
  if (data.calendar?.length) {
    for (const e of data.calendar) {
      const loc = e.location || '';
      const isVague = !loc || loc.length < 5 || loc.toLowerCase().includes('?');
      
      html += `<div style="margin-bottom:8px;">
        <strong>${new Date(e.start.dateTime).toLocaleTimeString('cs-CZ', {hour:'2-digit',minute:'2-digit'})}</strong> ${e.summary}
        <br><span style="color:#666; font-size:13px;">📍 ${loc || 'Bez místa'}</span>`;
        
      if (isVague) {
        // Need CP ID for location update, simplified for MVP to use generic link if no CP linked
        // In real app we'd look up the CP linked to event.
        // For now, assume we can trigger a manual update
        html += ` ${genLink('update_location', '0', '✏️ Upřesnit', '#D32F2F', {cp_id: 'UNKNOWN'})}`;
      }
      html += `</div>`;
    }
  } else {
    html += `<p style="color:#777;">Žádné schůzky.</p>`;
  }

  // 4. TODOS (Management)
  html += `<h3 style="border-bottom:2px solid #1a5f7a; color:#1a5f7a; margin-top:25px;">✅ Úkoly</h3>`;
  const pending = data.todos.filter(t => t.status !== 'completed');
  if (pending.length) {
    for (const t of pending) {
      const isToday = t.due_date === new Date().toISOString().split('T')[0];
      const color = isToday ? '#000' : '#777';
      
      html += `<div style="margin-bottom:10px; color:${color};">
        • ${t.description} <span style="font-size:11px;">(${t.due_date})</span><br>
        <div style="margin-left:15px; margin-top:2px;">
          ${genLink('move_todo', t.id, '➡️ Zítra', '#555', {val:'tomorrow'})}
          ${genLink('move_todo', t.id, '➡️ Později', '#555', {val:'later'})}
          ${genLink('dismiss_todo', t.id, '🗑️ Hotovo', '#777')}
        </div>
      </div>`;
    }
  } else {
    html += `<p style="color:#777;">Hotovo.</p>`;
  }

  html += `</div>`;
  return html;
}

// --- HANDLER ---
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { data: clients } = await supabase.from('users').select('*');
    for (const client of clients) {
      if (!client.google_oauth_tokens) continue;
      
      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials(client.google_oauth_tokens);
      
      const dbData = await getDailyData(client.id, oauth2Client);
      const html = generateHtml(dbData, client.settings?.name || 'Agent');
      
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      
      // Send Email
      const subject = `⚡ Brief: ${new Date().toLocaleDateString('cs-CZ')}`;
      const utf8Subject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
      const body = [
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `To: ${client.email}`,
        `Subject: ${utf8Subject}`,
        '',
        html
      ].join('\n');
      
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: Buffer.from(body).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
      });
    }
    res.status(200).json({ status: 'OK' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
