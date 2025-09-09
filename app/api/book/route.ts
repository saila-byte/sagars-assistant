import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getTokens } from '@/lib/googleTokens';

export const runtime = 'nodejs';

function addMinutes(d: Date, m: number) { return new Date(d.getTime() + m * 60_000); }

export async function POST(req: Request) {
  try {
    const { email, start_time, duration = 15, title = 'Meeting with Sagar', notes = '' } = await req.json();

    if (!email || !start_time) {
      return NextResponse.json({ error: 'email and start_time are required' }, { status: 400 });
    }

    const tokens = getTokens();
    if (!tokens) {
      return NextResponse.json(
        { error: 'Google not connected. Visit /api/google/oauth/start first.' },
        { status: 401 }
      );
    }

    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI!;
    const calendarId = process.env.SAGAR_CALENDAR_ID || 'primary';

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials(tokens);

    const calendar = google.calendar({ version: 'v3', auth: oauth2 });
    const start = new Date(start_time);
    const end = addMinutes(start, Number(duration));

    // Free/busy check
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        timeZone: 'America/Los_Angeles',
        items: [{ id: calendarId }],
      },
    });
    const busy = (fb.data.calendars?.[calendarId] as any)?.busy;
    if (busy && busy.length) {
      return NextResponse.json({ error: 'Time is no longer available' }, { status: 409 });
    }

    // Create event (with Google Meet)
    const ev = await calendar.events.insert({
      calendarId,
      conferenceDataVersion: 1,
      sendUpdates: 'all',
      requestBody: {
        summary: title,
        description: notes,
        start: { dateTime: start.toISOString(), timeZone: 'America/Los_Angeles' },
        end: { dateTime: end.toISOString(), timeZone: 'America/Los_Angeles' },
        attendees: [{ email }],
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      eventId: ev.data.id,
      htmlLink: ev.data.htmlLink,
      hangoutLink: ev.data.hangoutLink,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'unknown error' }, { status: 500 });
  }
}
