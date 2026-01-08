import { google } from 'googleapis';
import { getOAuth2Client } from '../../lib/google-auth';
import { AgentContext } from '../agentContext';
import { retry } from '../retryPolicy';
import { assertEventNotProcessed } from '../idempotency';

const addHours = (date: Date, h: number) => new Date(date.getTime() + h * 60 * 60 * 1000);
const addDays = (date: Date, d: number) => new Date(date.getTime() + d * 24 * 60 * 60 * 1000);

async function findFreeSlots(calendar: any, startSearch: Date, durationMins: number, count = 3) {
  const slots = [];
  let candidate = new Date(startSearch);

  const endSearch = addDays(candidate, 3);

  while (slots.length < count && candidate < endSearch) {
    const hour = candidate.getHours();
    if (hour < 9 || hour > 17) {
      candidate = addHours(candidate, 1);
      continue;
    }

    const endCandidate = new Date(candidate.getTime() + durationMins * 60000);

    const res = await retry(() => calendar.events.list({
      calendarId: 'primary',
      timeMin: candidate.toISOString(),
      timeMax: endCandidate.toISOString(),
      singleEvents: true
    }));

    const items = (res as { items?: any[] }).items ?? [];
     if (items.length === 0) {

      slots.push({ start: candidate.toISOString(), end: endCandidate.toISOString() });
      candidate = addHours(candidate, 2);
    } else {
      candidate = addHours(candidate, 1);
    }
  }
  return slots;
}

export async function scheduleAction(
  ctx: AgentContext,
  cpId: string,
  classification: any,
  emailData: any,
  threadId: string | null
): Promise<void> {
  if (classification.type !== 'EVENT') return;

  const duration = classification.event_details?.duration_minutes || 60;
  const requestedTime = classification.event_details?.requested_time
    ? new Date(classification.event_details.requested_time)
    : addDays(new Date(), 1);

  // Check Conflict
  const conflictCheck = await retry(() => ctx.calendar.events.list({
    calendarId: 'primary',
    timeMin: requestedTime.toISOString(),
    timeMax: new Date(requestedTime.getTime() + duration * 60000).toISOString(),
    singleEvents: true
  }));

  let actionStatus = 'pending';
  let draftReply = '';

  if (conflictCheck.data.items.length === 0) {
    // FREE -> Suggest Accept
    actionStatus = 'suggest_accept';
    draftReply = `Dobrý den, potvrzuji termín ${requestedTime.toLocaleString('cs-CZ')}.`;

    // Tentative Hold
    await retry(() => ctx.calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: `[HOLD] ${classification.summary_czech}`,
        start: { dateTime: requestedTime.toISOString() },
        end: { dateTime: new Date(requestedTime.getTime() + duration * 60000).toISOString() },
        colorId: '8'
      }
    }));

  } else {
    // BUSY -> Suggest Options
    actionStatus = 'suggest_reschedule';
    const alternatives = await findFreeSlots(ctx.calendar, requestedTime, duration);
    const altText = alternatives.map(s => new Date(s.start).toLocaleString('cs-CZ')).join(', ');
    draftReply = `Bohužel v tento čas nemohu. Hodilo by se vám: ${altText}?`;
  }

  // Save Action to DB (Using Todos as "Action Items")
  const todoDescription = `REPLY DRAFT: ${draftReply}`;

  const canInsert = await assertEventNotProcessed(ctx.supabase, todoDescription, ctx.clientId);
  if (!canInsert) return;

  await ctx.supabase.from('todos').insert({
    user_id: ctx.clientId,
    cp_id: cpId,
    thread_id: threadId,
    description: todoDescription,
    status: 'pending',
    due_date: new Date().toISOString().split('T')[0]
  });
}
