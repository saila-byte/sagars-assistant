import { NextResponse } from 'next/server';
import { getCalendarClient } from '@/lib/google';

export const runtime = 'nodejs';

export async function GET() {
  try {
    // Try to create a calendar client - this will test if we have a valid refresh token
    const calendar = await getCalendarClient();
    
    // Test the connection by making a simple API call
    await calendar.calendarList.list({ maxResults: 1 });
    
    return NextResponse.json({
      connected: true,
      message: 'Google OAuth connected with auto-refresh enabled',
      note: 'Access tokens are automatically refreshed by the Google SDK'
    });
  } catch (error: unknown) {
    const errorMessage = (error as Error)?.message || 'Unknown error';
    
    // Check if it's a refresh token issue
    if (errorMessage.includes('invalid_grant') || errorMessage.includes('refresh_token')) {
      return NextResponse.json({
        connected: false,
        message: 'Refresh token invalid or expired',
        action: 'Visit /api/google/oauth/start to re-authenticate',
        error: errorMessage
      });
    }
    
    return NextResponse.json({
      connected: false,
      message: 'Google OAuth not connected',
      action: 'Visit /api/google/oauth/start to authenticate',
      error: errorMessage
    });
  }
}
