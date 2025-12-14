import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';
import { getOAuth2Client } from './google-auth.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function getTodayDate() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

function getDayOfWeek() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date().getDay()];
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
    return { start: preferredStart, end: preferredEnd, conflict: false };
  }
  
  console.log('[CALENDAR] Conflict detected at ' + preferredStart);
  return { start: preferredStart, end: preferredEnd, conflict: true };
}

async function addCalendarEvent(oauth2Client, eventDetails, cpEmail, status) {
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
        status: status || 'tentative',
        extendedProperties: {
          private: {
            cpEmail: cpEmail || '',
            status: 'suggested'
          }
        }
      }
    });
    console.log('[CALENDAR] Event created: ' + res.data.id);
    return res.data.id;
  } catch (err) {
    console.error('Calendar insert error:', err.message);
    return null;
  }
}

export async function handleAction(supabase, userId, cpId, classification, emailData, threadId) {
  const actionType = classification.secondary;
  console.log('[ACTION] Type: ' + actionType);
  if (!actionType || actionType === 'null' || actionType === 'inactive') return;

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const { data: user } = await supabase.from('users').select('google_oauth_tokens').eq('id', userId).single();
  let oauth2Client = null;
  if (user && user.google_oauth_tokens) {
    oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(user.google_oauth_tokens);
  }

  const { data: cp } = await supabase.from('cps').select('primary_identifier, name').eq('id', cpId).single();
  const cpEmail = cp ? cp.primary_identifier : '';
  const cpName = cp ? cp.name : 'Contact';

  if (actionType === 'event') {
    const prompt = 'You extract calendar events from emails. Be EXACT with times.\n\nToday is ' + getTodayDate() + ' (' + getDayOfWeek() + ').\nTimezone: Europe/Prague\n\nEmail from: ' + cpName + '\nEmail text:\n"""\n' + emailData.cleanedText + '\n"""\n\nExtract the meeting details. If the email says "Friday 14:00" and today is ' + getDayOfWeek() + ', calculate the exact date.\n\nOutput JSON only:\n{\n  "title": "Short title in Czech",\n  "start_time": "YYYY-MM-DDTHH:MM:00+01:00",\n  "end_time": "YYYY-MM-DDTHH:MM:00+01:00",\n  "location": "Exact location from email or TBD",\n  "description": "One sentence context in Czech"\n}\n\nRules:\n- Use EXACT time from email, do not change it\n- If email says 14:00, output 14:00, not 10:00 or 15:00\n- Default duration 1 hour if not specified\n- Location: use exact address if given, otherwise TBD';

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const eventDetails = JSON.parse(jsonString);

      console.log('[EVENT] Extracted: ' + eventDetails.start_time + ' at ' + eventDetails.location);

      let calendarEventId = null;
      let hasConflict = false;
      
      if (oauth2Client) {
        const slotCheck = await findFreeSlot(oauth2Client, eventDetails.start_time, eventDetails.end_time);
        hasConflict = slotCheck.conflict;
        
        if (!hasConflict) {
          calendarEventId = await addCalendarEvent(oauth2Client, eventDetails, cpEmail, 'tentative');
        }
      }

      await supabase.from('events').insert({
        user_id: userId,
        cp_id: cpId,
        title: eventDetails.title,
        start_time: eventDetails.start_time,
        end_time: eventDetails.end_time,
        location: eventDetails.location,
        description: eventDetails.description,
        status: hasConflict ? 'conflict' : 'suggested'
      });

      console.log('[ACTION] Event saved: ' + eventDetails.title + (hasConflict ? ' (CONFLICT)' : ''));

    } catch (err) {
      console.error('Event Extraction Error:', err.message);
    }
  }

  if (actionType.includes('todo')) {
    const prompt = 'Extract a task from this email.\n\nEmail:\n"""\n' + emailData.cleanedText + '\n"""\n\nOutput JSON only:\n{\n  "description": "Task in Czech, no ÚKOL prefix",\n  "due_date": "YYYY-MM-DD"\n}';

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const todoDetails = JSON.parse(jsonString);

      await supabase.from('todos').insert({
        user_id: userId,
        cp_id: cpId,
        thread_id: threadId,
        description: todoDetails.description,
        due_date: todoDetails.due_date,
        status: 'pending'
      });
      
      console.log('[ACTION] Todo: ' + todoDetails.description);

    } catch (err) {
      console.error('Todo Extraction Error:', err.message);
    }
  }
}
