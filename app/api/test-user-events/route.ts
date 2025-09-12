import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getValidTokens } from '@/lib/googleTokens';

export const runtime = 'nodejs';

const findUserEvents = async (userEmail: string) => {
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
  
  // Search for events where user is an attendee
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // Next 30 days
    singleEvents: true,
    orderBy: 'startTime',
    q: userEmail // Search by attendee email
  });
  
  return response.data.items?.filter(event => 
    event.attendees?.some(attendee => 
      attendee.email === userEmail && attendee.responseStatus !== 'declined'
    )
  ) || [];
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userEmail = searchParams.get('email');
    
    if (!userEmail) {
      return NextResponse.json({ error: 'Email parameter is required' }, { status: 400 });
    }

    console.log('🔍 [TEST] Searching for events for user:', userEmail);
    
    const userEvents = await findUserEvents(userEmail);
    
    console.log('🔍 [TEST] Found events:', userEvents.length);
    
    // Format the response for easier reading
    const formattedEvents = userEvents.map(event => ({
      id: event.id,
      summary: event.summary,
      start: event.start,
      end: event.end,
      attendees: event.attendees?.map(att => ({
        email: att.email,
        responseStatus: att.responseStatus
      })),
      description: event.description,
      htmlLink: event.htmlLink
    }));

    return NextResponse.json({
      success: true,
      userEmail,
      totalEvents: userEvents.length,
      events: formattedEvents
    });

  } catch (error: unknown) {
    console.error('🔍 [TEST] Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: String(error)
    }, { status: 500 });
  }
}
