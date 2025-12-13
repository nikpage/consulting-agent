import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';
import { getOAuth2Client } from './google-auth.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function getContextDate() {
  return new Date().toISOString();
}

async function getCzHolidays(year) {
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/CZ`);
    const holidays = await res.json();
    return holidays.map(h => h.date);
  } catch (err) {
    console.error('Failed to fetch CZ holidays:', err.message);
    return [];
  }
}

async function getNextValidBusinessTime(dateString) {
  let date = new Date(dateString);
  const year = date.getFullYear();
  const holidays = await getCzHolidays(year);

  for (let i = 0; i < 30; i++) {
    const day = date.getDay();
    const hour = date.getHours();
    const dateOnly = date.toISOString().split('T')[0];

    if (day === 0) date.setDate(date.getDate() + 1);
    else if (day === 6) date.setDate(date.getDate() + 2);
    else if (holidays.includes(dateOnly)) date.setDate(date.getDate() + 1);
    else if (hour < 7) { date.setHours(7, 0, 0, 0); return date.toISOString(); }
    else if (hour >= 19) { date.setDate(date.getDate() + 1); date.setHours(7, 0, 0, 0); }
    else return date.toISOString();
  }

  return dateString;
}

async function sendNotification(supabase, userId, eventDetails, oauth2Client) {
  const { data: user } = await supabase.from('users').select('email, settings').eq('id', userId).single();
  const notifyType = user?.settings?.notifications?.type || 'email';

  if (notifyType === 'email') {
    await sendEmailNotification(oauth2Client, user.email, eventDetails, user.settings?.name || 'Client');
  } else if (notifyType === 'sms') {
    console.log('[NOTIFY] SMS not yet implemented');
  } else if (notifyType === 'app') {
    console.log('[NOTIFY] App notification not yet implemented');
  }
}

async function sendEmailNotification(oauth2Client, toEmail, eventDetails, clientName) {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const subject = 'Návrh Schůzky od vašeho ';
  const utf8Subject = Buffer.from(subject).toString('base64');
  const encodedSubject = `=?UTF-8?B?${utf8Subject}?=`;

  const startDate = new Date(eventDetails.start_time);
  const formattedDate = startDate.toLocaleDateString('cs-CZ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const formattedTime = startDate.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });

  const bodyHtml = `
    <p>Dobrý den${clientName ? ' ' + clientName : ''},</p>
    <p>Na základě vaší komunikace navrhuji následující schůzku:</p>
    <ul>
      <li><strong>Název:</strong> ${eventDetails.title}</li>
      <li><strong>Datum:</strong> ${formattedDate}</li>
      <li><strong>Čas:</strong> ${formattedTime}</li>
      <li><strong>Místo:</strong> ${eventDetails.location}</li>
    </ul>
    <p>${eventDetails.description}</p>
    <p>Schůzka byla přidána do vašeho kalendáře jako <strong>návrh</strong>. Pokud ji potvrdíte, automaticky odešlu pozvánku protistraně.</p>
  `;

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
    `To: ${toEmail}`,
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

  try {
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        labelIds: ["STARRED", "IMPORTANT", "INBOX"]
      }
    });
    console.log(`[NOTIFY] Email sent to ${toEmail}`);
  } catch (err) {
    console.error('Email send error:', err.message);
  }
}

async function findFreeSlot(oauth2Client, preferredStart, preferredEnd) {
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const existing = await calendar.events.list({
    calendarId: 'primary',
    timeMin: preferredStart,
    timeMax: preferredEnd,
    singleEvents: true
  });

  if (!existing.data.items || existing.data.items.length === 0) {
    return { start: preferredStart, end: preferredEnd };
  }

  console.log(`[CALENDAR] Conflict at ${preferredStart}, searching for free slot...`);

  const startDate = new Date(preferredStart);
  const duration = new Date(preferredEnd) - new Date(preferredStart);

  for (let day = 0; day < 7; day++) {
    const checkDate = new Date(startDate);
    checkDate.setDate(checkDate.getDate() + day);

    for (let hour = 9; hour <= 16; hour++) {
      const slotStart = new Date(checkDate);
      slotStart.setHours(hour, 0, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + duration);

      const conflicts = await calendar.events.list({
        calendarId: 'primary',
        timeMin: slotStart.toISOString(),
        timeMax: slotEnd.toISOString(),
        singleEvents: true
      });

      if (!conflicts.data.items || conflicts.data.items.length === 0) {
        console.log(`[CALENDAR] Found free slot: ${slotStart.toISOString()}`);
        return { start: slotStart.toISOString(), end: slotEnd.toISOString() };
      }
    }
  }

  console.log(`[CALENDAR] No free slot found, using original time`);
  return { start: preferredStart, end: preferredEnd };
}

async function addTentativeCalendarEvent(oauth2Client, eventDetails, cpEmail) {
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  try {
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: eventDetails.title,
        location: eventDetails.location,
        description: eventDetails.description,
        start: { dateTime: eventDetails.start_time, timeZone: 'Europe/Prague' },
        end: { dateTime: eventDetails.end_time, timeZone: 'Europe/Prague' },
        status: 'tentative',
        extendedProperties: {
          private: {
            cpEmail: cpEmail || '',
            status: 'suggested'
          }
        }
      }
    });
    console.log(`[CALENDAR] Tentative event created: ${res.data.id}`);
    return res.data.id;
  } catch (err) {
    console.error('Calendar insert error:', err.message);
    return null;
  }
}

export async function handleAction(supabase, userId, cpId, threadId, classification, emailData) {
  const actionType = classification.secondary;
  console.log(`[ACTION] Type: ${actionType}`);
  if (!actionType || actionType === 'null' || actionType === 'inactive') return;

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const { data: user } = await supabase.from('users').select('google_oauth_tokens').eq('id', userId).single();
  let oauth2Client = null;
  if (user?.google_oauth_tokens) {
    oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(user.google_oauth_tokens);
  }

  const { data: cp } = await supabase.from('cps').select('primary_identifier').eq('id', cpId).single();
  const cpEmail = cp?.primary_identifier || '';

  if (actionType === 'event') {
    const prompt = `
      Role: Human Executive Assistant.
      Task: Extract calendar event details from an email.
      Current Time: ${getContextDate()}

      Email Sender: ${emailData.from}
      Email Body: """${emailData.cleanedText}"""

      LANGUAGE REQUIREMENT:
      - **Output Language:** Czech (CS).
      - **Note:** You may include English (ENG) in brackets if the translation is ambiguous.

      Instructions for LOCATION:
      1. If a specific address is found (e.g., "Novodvorská 13"), use it.
      2. If "my office" or "my place" is mentioned, look for an address in the email signature. If found, use it. If not, use "Kancelář odesílatele (Ověřit)".
      3. If "call", "zoom", "meet" (virtual) is implied, use "Remote/Online".
      4. If explicitly stated as "The Office" and you lack a database reference, use "Kancelář (Ověřit)".
      5. If completely unknown, use "TBD".

      Output JSON:
      {
        "title": "Short, professional event title in Czech",
        "start_time": "ISO 8601 string (assume next occurrence if day name used)",
        "end_time": "ISO 8601 string (default to 1 hour after start)",
        "location": "The inferred location",
        "description": "One sentence context in Czech."
      }
    `;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const jsonString = text.replace(/^```json/gm, '').replace(/^```/gm, '').trim();
      const eventDetails = JSON.parse(jsonString);

      const validStart = await getNextValidBusinessTime(eventDetails.start_time);
      const validEnd = await getNextValidBusinessTime(eventDetails.end_time);

      let calendarEventId = null;
      if (oauth2Client) {
        const freeSlot = await findFreeSlot(oauth2Client, validStart, validEnd);
        eventDetails.start_time = freeSlot.start;
        eventDetails.end_time = freeSlot.end;

        calendarEventId = await addTentativeCalendarEvent(oauth2Client, eventDetails, cpEmail);
        await sendNotification(supabase, userId, eventDetails, oauth2Client);
      }

      await supabase.from('events').insert({
        user_id: userId,
        cp_id: cpId,
        title: eventDetails.title,
        start_time: eventDetails.start_time,
        end_time: eventDetails.end_time,
        location: eventDetails.location,
        description: eventDetails.description,
        status: 'suggested'
      });
      console.log(`[ACTION] Suggested event: ${eventDetails.title} @ ${eventDetails.location}`);

    } catch (err) {
      console.error('Event Extraction Error:', err.message);
    }
  }

  if (actionType.includes('todo')) {
    const prompt = `
      Role: Human Executive Assistant.
      Task: Create a concise To-Do task from this email.
      Email Body: """${emailData.cleanedText}"""

      LANGUAGE REQUIREMENT:
      - **Output Language:** Czech (CS).

      Output JSON: { "description": "Actionable task string in Czech", "due_date": "YYYY-MM-DD" }
    `;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const jsonString = text.replace(/^```json/gm, '').replace(/^```/gm, '').trim();
      const todoDetails = JSON.parse(jsonString);

      let dueDate = new Date(todoDetails.due_date);
      const today = new Date();
      today.setHours(0,0,0,0);
      if (isNaN(dueDate) || dueDate < today) {
        dueDate = today;
      }
      todoDetails.due_date = dueDate.toISOString().split('T')[0];

      await supabase.from('todos').insert({
        user_id: userId,
        cp_id: cpId,
        thread_id: threadId,
        description: todoDetails.description,
        due_date: todoDetails.due_date,
        status: 'pending'
      });
      console.log(`[ACTION] Created todo: ${todoDetails.description} (thread: ${threadId})`);

    } catch (err) {
      console.error('Todo Extraction Error:', err.message);
    }
  }
}
