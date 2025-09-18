import { NextResponse } from 'next/server';
import { getCalendarClient } from '@/lib/google';

export const runtime = 'nodejs';

function addMinutes(d: Date, m: number) { return new Date(d.getTime() + m * 60_000); }

export async function POST(req: Request) {
  try {
    console.log('[book] === CALENDAR BOOKING START ===');
    
    const { email, start_time, duration = 30, title = 'Meeting with Hassaan', notes = '', timezone = 'America/Los_Angeles' } = await req.json();
    console.log('[book] Request parameters:', { email, start_time, duration, title, notes, timezone });

    if (!email || !start_time) {
      console.error('[book] Missing required parameters:', { email, start_time });
      return NextResponse.json({ error: 'email and start_time are required' }, { status: 400 });
    }

    console.log('[book] Getting Google Calendar client...');
    const calendar = await getCalendarClient();
    console.log('[book] Google Calendar client obtained (auto-refresh enabled)');

    const calendarId = process.env.HASSAAN_CALENDAR_ID || 'primary';
    const start = new Date(start_time);
    const end = addMinutes(start, Number(duration));

    console.log('[book] Event timing:', {
      start: start.toISOString(),
      end: end.toISOString(),
      duration: Number(duration)
    });

    // Free/busy check
    console.log('[book] Checking free/busy status...');
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        timeZone: timezone,
        items: [{ id: calendarId }],
      },
    });
    console.log('[book] Free/busy response:', fb.data);
    
    const busy = (fb.data.calendars?.[calendarId] as { busy?: Array<{ start: string; end: string }> })?.busy;
    console.log('[book] Busy periods:', busy);
    
    if (busy && busy.length) {
      console.error('[book] Time slot is busy:', busy);
      return NextResponse.json({ error: 'Time is no longer available' }, { status: 409 });
    }
    console.log('[book] Time slot is free, proceeding with booking...');

    // Create event (with Google Meet)
    const eventData = {
      summary: title,
      description: `${notes}\n\nBooked via Hassaan's assistant\nUser: ${email}`,
      start: { dateTime: start.toISOString(), timeZone: timezone },
      end: { dateTime: end.toISOString(), timeZone: timezone },
      attendees: [{ email }],
      conferenceData: {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };
    
    console.log('[book] Creating calendar event with data:', eventData);
    console.log('[book] Sending updates to all attendees (Gmail invites)...');
    
    const ev = await calendar.events.insert({
      calendarId,
      conferenceDataVersion: 1,
      sendUpdates: 'all', // This is what sends the Gmail invites!
      requestBody: eventData,
    });

    console.log('[book] Event created successfully!');
    console.log('[book] Event details:', {
      id: ev.data.id,
      htmlLink: ev.data.htmlLink,
      hangoutLink: ev.data.hangoutLink,
      attendees: ev.data.attendees,
      conferenceData: ev.data.conferenceData
    });

    return NextResponse.json({
      ok: true,
      eventId: ev.data.id,
      htmlLink: ev.data.htmlLink,
      hangoutLink: ev.data.hangoutLink,
    });
  } catch (e: unknown) {
    console.error('[book] Error during calendar booking:', e);
    const error = e as Error & { code?: string; status?: number; response?: { data?: unknown } };
    console.error('[book] Error details:', {
      message: error?.message,
      code: error?.code,
      status: error?.status,
      response: error?.response?.data
    });
    return NextResponse.json({ error: error?.message || 'unknown error' }, { status: 500 });
  }
}
