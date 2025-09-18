import { NextResponse } from 'next/server';
import { getCalendarClient } from '@/lib/google';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const calendar = await getCalendarClient();

    // Get calendar list to see what calendars are available
    const calendarList = await calendar.calendarList.list();

    return NextResponse.json({
      message: 'Google Calendar connection successful with auto-refresh',
      calendars: calendarList.data.items?.map(cal => ({
        id: cal.id,
        summary: cal.summary,
        primary: cal.primary,
        accessRole: cal.accessRole
      })),
      currentCalendarId: process.env.HASSAAN_CALENDAR_ID || 'primary'
    });
  } catch (error: unknown) {
    const errorMessage = (error as Error)?.message || 'Unknown error';
    
    if (errorMessage.includes('invalid_grant') || errorMessage.includes('refresh_token')) {
      return NextResponse.json({ 
        error: 'Refresh token invalid or expired',
        action: 'Visit /api/google/oauth/start to re-authenticate',
        details: errorMessage
      }, { status: 401 });
    }
    
    return NextResponse.json({ 
      error: 'Google OAuth not connected',
      action: 'Visit /api/google/oauth/start to authenticate',
      details: errorMessage
    }, { status: 401 });
  }
}
