import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getValidTokens } from '@/lib/googleTokens';

export const runtime = 'nodejs';

function addMinutes(d: Date, m: number) { return new Date(d.getTime() + m * 60_000); }

// Helper function to find user's future assistant-booked events
const findUserAssistantEvents = async (userEmail: string) => {
  const tokens = await getValidTokens();
  if (!tokens) {
    throw new Error('No valid Google OAuth tokens found');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2.setCredentials(tokens);

  const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  
  // Search for future events where user is an attendee
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(), // Only future events
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50 // Reasonable limit for future events
  });
  
  // Filter for events where user is attendee and was booked via assistant
  const userMeetings = response.data.items?.filter(event => 
    event.attendees?.some(attendee => 
      attendee.email === userEmail && attendee.responseStatus !== 'declined'
    ) &&
    event.description?.includes('Booked via Hassaan\'s assistant')
  ) || [];
  
  return userMeetings;
};

export async function POST(req: Request) {
  try {
    console.log('🔄 [RESCHEDULE] === RESCHEDULE REQUEST START ===');
    
    const { 
      userEmail, 
      newStartTime, 
      newEndTime, 
      reason = 'User requested reschedule',
      eventId = null // Optional: specific event ID to reschedule
    } = await req.json();
    
    console.log('[reschedule] Request parameters:', { 
      userEmail, 
      newStartTime, 
      newEndTime, 
      reason, 
      eventId 
    });

    if (!userEmail || !newStartTime) {
      console.error('[reschedule] Missing required parameters:', { userEmail, newStartTime });
      return NextResponse.json({ 
        error: 'userEmail and newStartTime are required' 
      }, { status: 400 });
    }

    console.log('[reschedule] Checking Google OAuth tokens...');
    const tokens = await getValidTokens();
    if (!tokens) {
      console.error('[reschedule] No valid Google OAuth tokens found');
      return NextResponse.json(
        { error: 'Google not connected. Visit /api/google/oauth/start first.' },
        { status: 401 }
      );
    }
    console.log('[reschedule] Valid Google OAuth tokens found');

    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI!;
    const calendarId = process.env.HASSAAN_CALENDAR_ID || 'primary';

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials(tokens);

    const calendar = google.calendar({ version: 'v3', auth: oauth2 });

    let eventToReschedule;

    if (eventId) {
      // If specific event ID provided, get that event
      console.log('[reschedule] Looking for specific event:', eventId);
      try {
        const event = await calendar.events.get({
          calendarId,
          eventId
        });
        eventToReschedule = event.data;
      } catch (error) {
        console.error('[reschedule] Event not found:', error);
        return NextResponse.json({ 
          error: 'Event not found or not accessible' 
        }, { status: 404 });
      }
    } else {
      // Find user's future meetings
      console.log('[reschedule] Finding future meetings for:', userEmail);
      const userMeetings = await findUserAssistantEvents(userEmail);
      
      if (userMeetings.length === 0) {
        console.error('[reschedule] No upcoming meetings found for user');
        return NextResponse.json({ 
          error: 'No upcoming meetings found for this user' 
        }, { status: 404 });
      }
      
      // Use the first (next) meeting
      eventToReschedule = userMeetings[0];
      console.log('[reschedule] Found meeting to reschedule:', {
        id: eventToReschedule.id,
        summary: eventToReschedule.summary,
        start: eventToReschedule.start
      });
    }

    // Parse new times
    const newStart = new Date(newStartTime);
    const newEnd = newEndTime ? new Date(newEndTime) : addMinutes(newStart, 30);

    console.log('[reschedule] New timing:', {
      start: newStart.toISOString(),
      end: newEnd.toISOString()
    });

    // Free/busy check for new time
    console.log('[reschedule] Checking free/busy status for new time...');
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: newStart.toISOString(),
        timeMax: newEnd.toISOString(),
        timeZone: 'America/Los_Angeles', // TODO: Use user's timezone
        items: [{ id: calendarId }],
      },
    });
    
    const busy = (fb.data.calendars?.[calendarId] as any)?.busy;
    console.log('[reschedule] Busy periods:', busy);
    
    if (busy && busy.length) {
      console.error('[reschedule] New time slot is busy:', busy);
      return NextResponse.json({ 
        error: 'The new time slot is no longer available' 
      }, { status: 409 });
    }
    console.log('[reschedule] New time slot is free, proceeding with reschedule...');

    // Update the event
    const updatedEventData = {
      summary: eventToReschedule.summary,
      description: `${eventToReschedule.description}\n\nRescheduled: ${reason}`,
      start: { 
        dateTime: newStart.toISOString(), 
        timeZone: eventToReschedule.start?.timeZone || 'America/Los_Angeles' 
      },
      end: { 
        dateTime: newEnd.toISOString(), 
        timeZone: eventToReschedule.end?.timeZone || 'America/Los_Angeles' 
      },
      attendees: eventToReschedule.attendees,
      // Preserve existing conference data
      conferenceData: eventToReschedule.conferenceData
    };
    
    console.log('[reschedule] Updating calendar event with data:', updatedEventData);
    console.log('[reschedule] Sending updates to all attendees...');
    
    const updatedEvent = await calendar.events.update({
      calendarId,
      eventId: eventToReschedule.id!,
      sendUpdates: 'all', // This sends the reschedule notification!
      requestBody: updatedEventData,
    });

    console.log('[reschedule] Event rescheduled successfully!');
    console.log('[reschedule] Updated event details:', {
      id: updatedEvent.data.id,
      htmlLink: updatedEvent.data.htmlLink,
      hangoutLink: updatedEvent.data.hangoutLink,
      attendees: updatedEvent.data.attendees,
      start: updatedEvent.data.start,
      end: updatedEvent.data.end
    });

    return NextResponse.json({
      ok: true,
      eventId: updatedEvent.data.id,
      htmlLink: updatedEvent.data.htmlLink,
      hangoutLink: updatedEvent.data.hangoutLink,
      originalEvent: {
        id: eventToReschedule.id,
        summary: eventToReschedule.summary,
        start: eventToReschedule.start
      },
      newEvent: {
        id: updatedEvent.data.id,
        summary: updatedEvent.data.summary,
        start: updatedEvent.data.start,
        end: updatedEvent.data.end
      }
    });

  } catch (e: any) {
    console.error('[reschedule] Error during reschedule:', e);
    console.error('[reschedule] Error details:', {
      message: e?.message,
      code: e?.code,
      status: e?.status,
      response: e?.response?.data
    });
    return NextResponse.json({ 
      error: e?.message || 'unknown error' 
    }, { status: 500 });
  }
}
