import { google } from 'googleapis'
import { setCredentials } from './google-auth'

export async function getCalendarEvents(tokens, startDate, endDate) {
  const oauth2Client = setCredentials(tokens)
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime'
  })

  return response.data.items || []
}

export async function findFreeSlots(tokens, date, userSettings) {
  const startOfDay = new Date(date)
  startOfDay.setHours(userSettings.workStartHour || 9, 0, 0, 0)
  
  const endOfDay = new Date(date)
  endOfDay.setHours(userSettings.workEndHour || 17, 0, 0, 0)

  const events = await getCalendarEvents(tokens, startOfDay, endOfDay)
  
  const freeSlots = []
  let currentTime = new Date(startOfDay)

  // Skip do-now block
  const doNowStart = userSettings.doNowStart || 9
  const doNowEnd = userSettings.doNowEnd || 10
  if (currentTime.getHours() < doNowEnd) {
    currentTime.setHours(doNowEnd, 0, 0, 0)
  }

  // Skip no-meeting-before time
  const noMeetingBefore = userSettings.noMeetingBefore || 9
  if (currentTime.getHours() < noMeetingBefore) {
    currentTime.setHours(noMeetingBefore, 0, 0, 0)
  }

  for (const event of events) {
    const eventStart = new Date(event.start.dateTime || event.start.date)
    const eventEnd = new Date(event.end.dateTime || event.end.date)

    if (currentTime < eventStart) {
      const gap = (eventStart - currentTime) / 1000 / 60 // minutes
      if (gap >= 60) { // At least 1 hour free
        freeSlots.push({
          start: new Date(currentTime),
          end: new Date(eventStart)
        })
      }
    }

    currentTime = eventEnd > currentTime ? new Date(eventEnd) : currentTime
  }

  // Check if there's time at end of day
  if (currentTime < endOfDay) {
    const gap = (endOfDay - currentTime) / 1000 / 60
    if (gap >= 60) {
      freeSlots.push({
        start: new Date(currentTime),
        end: new Date(endOfDay)
      })
    }
  }

  return freeSlots
}

export async function proposeEventSlots(tokens, userSettings, location, cpLocation) {
  const today = new Date()
  const slots = []

  // Try next 7 days
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(today)
    checkDate.setDate(today.getDate() + i)
    
    const freeSlots = await findFreeSlots(tokens, checkDate, userSettings)
    
    for (const slot of freeSlots) {
      // Calculate travel time if location provided
      let travelTime = 0
      if (location && userSettings.defaultLocation) {
        travelTime = await calculateTravelTime(
          userSettings.defaultLocation,
          location
        )
      }

      // Propose 1-hour slots with buffer
      const proposedStart = new Date(slot.start.getTime() + travelTime * 60000)
      const proposedEnd = new Date(proposedStart.getTime() + 60 * 60000)

      if (proposedEnd <= slot.end) {
        slots.push({
          start: proposedStart,
          end: proposedEnd,
          location: location
        })
      }

      if (slots.length >= 3) break
    }
    if (slots.length >= 3) break
  }

  return slots.slice(0, 3)
}

export async function createCalendarEvent(tokens, eventData) {
  const oauth2Client = setCredentials(tokens)
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  const event = {
    summary: eventData.summary,
    location: eventData.location,
    start: {
      dateTime: eventData.start.toISOString(),
      timeZone: 'Europe/Prague'
    },
    end: {
      dateTime: eventData.end.toISOString(),
      timeZone: 'Europe/Prague'
    },
    attendees: eventData.attendees || []
  }

  const response = await calendar.events.insert({
    calendarId: 'primary',
    resource: event
  })

  return response.data
}

async function calculateTravelTime(origin, destination) {
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=${process.env.GOOGLE_MAPS_API_KEY}`
  
  const response = await fetch(url)
  const data = await response.json()
  
  if (data.rows[0]?.elements[0]?.duration) {
    return Math.ceil(data.rows[0].elements[0].duration.value / 60) // minutes
  }
  
  return 30 // default 30 min buffer
}
