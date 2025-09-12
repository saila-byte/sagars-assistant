import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getValidTokens } from '@/lib/googleTokens';

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

    console.log('[book] Checking Google OAuth tokens...');
    const tokens = await getValidTokens();
    if (!tokens) {
      console.error('[book] No valid Google OAuth tokens found');
      return NextResponse.json(
        { error: 'Google not connected. Visit /api/google/oauth/start first.' },
        { status: 401 }
      );
    }
    console.log('[book] Valid Google OAuth tokens found');

    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI!;
    const calendarId = process.env.HASSAAN_CALENDAR_ID || 'primary';

    console.log('[book] Environment variables:', { 
      hasClientId: !!clientId, 
      hasClientSecret: !!clientSecret, 
      hasRedirectUri: !!redirectUri, 
      calendarId 
    });

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials(tokens);

    const calendar = google.calendar({ version: 'v3', auth: oauth2 });
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
    console.error('[book] Error details:', {
      message: e instanceof Error ? e.message : 'Unknown error',
      code: (e as { code?: unknown })?.code,
      status: (e as { status?: unknown })?.status,
      response: (e as { response?: { data?: unknown } })?.response?.data
    });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unknown error' }, { status: 500 });
  }
}
