import { google } from 'googleapis';
import { getOAuth2Client } from './google-auth';

// Helper: Add hours to a date
const addHours = (date, h) => new Date(date.getTime() + h * 60 * 60 * 1000);
const addDays = (date, d) => new Date(date.getTime() + d * 24 * 60 * 60 * 1000);

async function findFreeSlots(calendar, startSearch, durationMins, count = 3) {
  const slots = [];
  let candidate = new Date(startSearch);
  
  // Search for next 3 days
  const endSearch = addDays(candidate, 3);

  while (slots.length < count && candidate < endSearch) {
    // Only business hours 9am-6pm
    const hour = candidate.getHours();
    if (hour < 9 || hour > 17) {
      candidate = addHours(candidate, 1);
      continue;
    }

    const endCandidate = new Date(candidate.getTime() + durationMins * 60000);
    
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: candidate.toISOString(),
      timeMax: endCandidate.toISOString(),
      singleEvents: true
    });

    if (res.data.items.length === 0) {
      slots.push({ start: candidate.toISOString(), end: endCandidate.toISOString() });
      candidate = addHours(candidate, 2); // Jump 2 hours
    } else {
      candidate = addHours(candidate, 1); // Jump 1 hour
    }
  }
  return slots;
}

export async function handleAction(supabase, userId, cpId, classification, emailData, threadId) {
  if (classification.type !== 'EVENT') return;

  const { data: user } = await supabase.from('users').select('google_oauth_tokens').eq('id', userId).single();
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(user.google_oauth_tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const duration = classification.event_details?.duration_minutes || 60;
  const requestedTime = classification.event_details?.requested_time 
    ? new Date(classification.event_details.requested_time) 
    : addDays(new Date(), 1); // Default to tomorrow if null

  // Check Conflict
  const conflictCheck = await calendar.events.list({
    calendarId: 'primary',
    timeMin: requestedTime.toISOString(),
    timeMax: new Date(requestedTime.getTime() + duration * 60000).toISOString(),
    singleEvents: true
  });

  let actionStatus = 'pending';
  let draftReply = '';

  if (conflictCheck.data.items.length === 0) {
    // FREE -> Suggest Accept
    actionStatus = 'suggest_accept';
    draftReply = `Dobrý den, potvrzuji termín ${requestedTime.toLocaleString('cs-CZ')}.`;
    
    // Tentative Hold
    await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: `[HOLD] ${classification.summary_czech}`,
        start: { dateTime: requestedTime.toISOString() },
        end: { dateTime: new Date(requestedTime.getTime() + duration * 60000).toISOString() },
        colorId: '8' // Grey
      }
    });

  } else {
    // BUSY -> Suggest Options
    actionStatus = 'suggest_reschedule';
    const alternatives = await findFreeSlots(calendar, requestedTime, duration);
    const altText = alternatives.map(s => new Date(s.start).toLocaleString('cs-CZ')).join(', ');
    draftReply = `Bohužel v tento čas nemohu. Hodilo by se vám: ${altText}?`;
  }

  // Log Action
  console.log(`[ACTION] Event: ${actionStatus}`);
  
  // Save Action to DB (Using Todos as "Action Items")
  await supabase.from('todos').insert({
    user_id: userId,
    cp_id: cpId,
    thread_id: threadId,
    description: `REPLY DRAFT: ${draftReply}`,
    status: 'pending', // User must approve
    due_date: new Date().toISOString().split('T')[0]
  });
}
