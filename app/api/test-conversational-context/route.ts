import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getValidTokens } from '@/lib/googleTokens';

export const runtime = 'nodejs';

// Helper function to fetch user's future assistant-booked events (same as in tavus/start)
async function fetchUserEvents(userEmail: string): Promise<string> {
  try {
    console.log('🔍 [TEST] Fetching user events for:', userEmail);
    const tokens = await getValidTokens();
    if (!tokens) {
      console.log('🔍 [TEST] No valid tokens found');
      return 'Unable to fetch user events (not authenticated)';
    }
    console.log('🔍 [TEST] Tokens found, proceeding with API call');

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
      timeMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // Next 30 days
      singleEvents: true,
      orderBy: 'startTime',
      q: userEmail, // Search by attendee email
      maxResults: 10 // Limit to prevent too much context
    });
    
    // Filter for events where user is attendee and was booked via assistant
    const userMeetings = response.data.items?.filter(event => 
      event.attendees?.some(attendee => 
        attendee.email === userEmail && attendee.responseStatus !== 'declined'
      ) &&
      event.description?.includes('Booked via Hassaan\'s assistant')
    ) || [];

    if (userMeetings.length === 0) {
      return 'User has no upcoming meetings booked through the assistant.';
    }

    // Format the events for the conversational context
    const formattedEvents = userMeetings.map(event => {
      const startTime = event.start?.dateTime ? new Date(event.start.dateTime) : null;
      const timeStr = startTime ? startTime.toLocaleString('en-US', { 
        weekday: 'long', 
        month: 'short', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Los_Angeles'
      }) : 'Unknown time';
      
      return `- ${event.summary} on ${timeStr} (Event ID: ${event.id})`;
    }).join('\n');

    return `User's upcoming meetings:\n${formattedEvents}`;
  } catch (error) {
    console.error('🔍 [TEST] Error fetching user events:', error);
    return `Unable to fetch user events: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Helper function to fetch calendar availability (same as in tavus/start)
async function fetchAvailability(timezone: string): Promise<string> {
  try {
    const origin = process.env.NODE_ENV === 'production'
      ? 'https://your-domain.com'
      : 'https://hassaan-assistant.loca.lt';
    
    const response = await fetch(`${origin}/api/calendly/availability?duration=30&timezone=${encodeURIComponent(timezone)}`);
    
    if (!response.ok) {
      return 'No availability data available';
    }
    
    const data = await response.json();
    
    if (data.slots && data.slots.length > 0) {
      // Group slots by day for better organization
      const slotsByDay = data.slots.reduce((acc: Record<string, Array<{ start_time: string }>>, slot: { start_time: string }) => {
        const date = new Date(slot.start_time);
        const dayKey = date.toLocaleDateString('en-US', { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric',
          timeZone: timezone 
        });
        if (!acc[dayKey]) acc[dayKey] = [];
        acc[dayKey].push(slot);
        return acc;
      }, {});

      // Format each day's slots
      const dayTexts = Object.entries(slotsByDay).map(([day, daySlots]) => {
        const times = (daySlots as Array<{ start_time: string }>).slice(0, 3).map((slot: { start_time: string }) => 
          new Date(slot.start_time).toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            timeZone: timezone 
          })
        ).join(', ');
        return `${day}: ${times}${(daySlots as Array<{ start_time: string }>).length > 3 ? ` (+${(daySlots as Array<{ start_time: string }>).length - 3} more)` : ''}`;
      });
      
      return `Available times: ${dayTexts.join('; ')}`;
    }
    
    return 'No available times found';
  } catch (error) {
    console.error('Error fetching availability:', error);
    return 'Unable to fetch availability';
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email') || 'test@example.com';
    const timezone = searchParams.get('timezone') || 'America/Los_Angeles';
    
    console.log('🔍 [TEST] Building conversational context for:', { email, timezone });
    
    // Fetch availability and user events
    const availability = await fetchAvailability(timezone);
    const userEvents = await fetchUserEvents(email);
    
    // Build the conversational context (same as in tavus/start)
    const conversationalContext = `You are Hassaan's calendar booking assistant. 

CRITICAL: You MUST use tool calls to book meetings and end calls.

When a user wants to book a meeting, use this tool call:
{
  "type": "conversation.tool_call",
  "tool_call_id": "tool_call_" + timestamp,
  "tool": {
    "name": "update_calendar",
    "arguments": {
      "email": "${email}",
      "duration": 30,
      "datetimeText": "the time they requested",
      "timezone": "${timezone}",
      "title": "Meeting with Hassaan",
      "notes": "Booked via Tavus assistant"
    }
  }
}

When the user is done, use this tool call:
{
  "type": "conversation.tool_call", 
  "tool_call_id": "tool_call_" + timestamp,
  "tool": {
    "name": "end_call",
    "arguments": {
      "reason": "user_completed_task"
    }
  }
}

User's email: ${email}. Timezone: ${timezone}. All meetings are 30 minutes.

IMPORTANT BOOKING RULES:
- Users can only have ONE active meeting at a time
- If user already has an upcoming meeting, offer to reschedule it instead of booking a new one
- Always check the user's existing meetings before offering to book a new one

${userEvents}

Available times for new bookings: ${availability}`;

    return NextResponse.json({
      success: true,
      email,
      timezone,
      availability,
      userEvents,
      conversationalContext,
      contextLength: conversationalContext.length
    });

  } catch (error: unknown) {
    console.error('🔍 [TEST] Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: String(error)
    }, { status: 500 });
  }
}
