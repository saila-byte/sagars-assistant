import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getTokens } from '@/lib/googleTokens';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const tokens = await getTokens();
    if (!tokens) {
      return NextResponse.json({ error: 'No OAuth tokens found' }, { status: 401 });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials(tokens);

    const calendar = google.calendar({ version: 'v3', auth: oauth2 });

    // Get calendar list to see what calendars are available
    const calendarList = await calendar.calendarList.list();
    
    // Get user info
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2Client.setCredentials(tokens);
    const oauth2Client2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2Client2.userinfo.get();

    return NextResponse.json({
      userInfo: userInfo.data,
      calendars: calendarList.data.items?.map(cal => ({
        id: cal.id,
        summary: cal.summary,
        primary: cal.primary,
        accessRole: cal.accessRole
      })),
      currentCalendarId: process.env.HASSAAN_CALENDAR_ID || 'primary'
    });
  } catch (error: any) {
    return NextResponse.json({ 
      error: error.message,
      details: error.toString()
    }, { status: 500 });
  }
}
