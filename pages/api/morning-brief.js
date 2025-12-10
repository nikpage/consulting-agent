import { Buffer } from "buffer";
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getDailyData(userId) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data: todos } = await supabase
    .from('todos')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['pending', 'in_progress'])
    .lte('due_date', todayEnd.toISOString().split('T')[0]);

  const { data: events } = await supabase
    .from('events')
    .select('*')
    .eq('user_id', userId)
    .gte('start_time', todayStart.toISOString())
    .lte('start_time', todayEnd.toISOString());

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  const { data: updates } = await supabase
    .from('conversation_threads')
    .select('topic, state, summary_text, last_updated, user_id')
    .gt('last_updated', yesterday.toISOString());

  const myUpdates = updates ? updates.filter(u => u.user_id === userId) : [];

  return { todos: todos || [], events: events || [], updates: myUpdates };
}

async function generateBrief(data, clientName) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const todoList = data.todos.map(t => `<li><strong>ÚKOL:</strong> ${t.description} (Termín: ${t.due_date})</li>`).join('');
  const eventList = data.events.map(e => `<li><strong>UDÁLOST:</strong> ${e.location} @ ${e.start_time}</li>`).join('');
  const updateList = data.updates.map(u => `<li><strong>${u.topic}</strong> (${u.state}): ${u.summary_text}</li>`).join('');

  const prompt = `
    Role: Executive Assistant.
    Task: Write the body of a daily briefing email for ${clientName}.
    Language: Czech (cs-CZ).
    Format: HTML (use <p>, <ul>, <li>, <strong>). Do NOT include <html> or <body> tags.
    Style: Professional, concise, larger font friendly.

    Input Data:
    Tasks: ${todoList ? '<ul>' + todoList + '</ul>' : 'Žádné úkoly.'}
    Events: ${eventList ? '<ul>' + eventList + '</ul>' : 'Žádné události.'}
    Activity: ${updateList ? '<ul>' + updateList + '</ul>' : 'Žádné aktualizace.'}

    Structure:
    1. Greeting (Dobrý den...)
    2. Sections for Úkoly, Události, and Aktivity.
    3. Closing sentence (encouraging).
    Do NOT add a signature.
  `;

  try {
    const result = await model.generateContent(prompt);
    let text = result.response.text();
    return text.replace(/```html/g, '').replace(/```/g, '');
  } catch (err) {
    console.error('GenAI Error:', err.message);
    return `<p>Error generating brief: ${err.message}</p>`;
  }
}

async function sendEmailToSelf(gmail, email, subject, bodyHtml) {
  const utf8Subject = Buffer.from(subject).toString('base64');
  const encodedSubject = `=?UTF-8?B?${utf8Subject}?=`;

  const fullHtml = `
    <div style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333;">
      ${bodyHtml}
      <br><br>
      <div style="font-size: 16px; font-weight: bold; color: #555;">
        S pozdravem,<br>
        Váš Výkonný Asistent Special Agent 23
      </div>
    </div>
  `;
  
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
        const dbData = await getDailyData(client.id);
        const briefBody = await generateBrief(dbData, client.settings.name || 'Client');
        const subject = 'Denní Přehled od vašeho Special Agent 23';
        
        const tokens = typeof client.google_oauth_tokens === 'string' 
          ? JSON.parse(client.google_oauth_tokens) 
          : client.google_oauth_tokens;
          
        const oauth2Client = getOAuth2Client();
        );
        oauth2Client.setCredentials(tokens);
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
