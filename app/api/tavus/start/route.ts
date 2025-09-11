// app/api/tavus/start/route.ts
import { NextResponse } from 'next/server';

type StartBody = {
  email?: string;       // kept for later use if you want to pass context
  duration?: number;    // kept for later use
  timezone?: string;    // kept for later use
};

// Helper function to fetch user's future assistant-booked events
async function fetchUserEvents(userEmail: string): Promise<string> {
  try {
    const tokens = await getValidTokens();
    if (!tokens) {
      return 'Unable to fetch user events (not authenticated)';
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
    console.error('Error fetching user events:', error);
    return 'Unable to fetch user events';
  }
}

// Helper function to fetch calendar availability
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
      const slotsByDay = data.slots.reduce((acc: any, slot: any) => {
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
      const dayTexts = Object.entries(slotsByDay).map(([day, daySlots]: [string, any]) => {
        const times = daySlots.slice(0, 3).map((slot: any) => 
          new Date(slot.start_time).toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            timeZone: timezone 
          })
        ).join(', ');
        return `${day}: ${times}${daySlots.length > 3 ? ` (+${daySlots.length - 3} more)` : ''}`;
      });

      return `Available slots: ${dayTexts.join(' | ')}`;
    }
    
    return 'No available slots found';
  } catch (error) {
    return 'Unable to fetch availability';
  }
}

export async function POST(req: Request) {
  try {
    // read body (not required for the minimal call)
    const body = (await req.json().catch(() => ({}))) as StartBody;
    const _email = (body?.email ?? '').toString().trim();
    const _duration = 30; // Only 30-minute meetings
    const _timezone =
      typeof body?.timezone === 'string' && body.timezone ? body.timezone : 'America/Los_Angeles';

    // --- Env & URL setup ---
    const RAW_BASE = (process.env.TAVUS_API_BASE || 'https://tavusapi.com/v2').trim();
    const TAVUS_API_BASE = RAW_BASE.replace(/\/+$/, ''); // strip trailing slash
    const conversationsURL = `${TAVUS_API_BASE}/conversations`;

    const apiKey    = (process.env.TAVUS_API_KEY || '').trim();
    const personaId = (process.env.TAVUS_PERSONA_ID || '').trim();
    const replicaId = (process.env.TAVUS_REPLICA_ID || '').trim(); // required per your curl


    // Require all 3
    if (!apiKey || !personaId || !replicaId) {
      return NextResponse.json(
        { error: 'Set TAVUS_API_KEY, TAVUS_PERSONA_ID, TAVUS_REPLICA_ID in .env.local' },
        { status: 500 }
      );
    }

    // --- Fetch availability and user events ---
    const availability = await fetchAvailability(_timezone);
    const userEvents = _email ? await fetchUserEvents(_email) : 'No user email provided';
    
    // --- Minimal payload to isolate auth/IDs (matches your working curl shape) ---
    const origin = process.env.NODE_ENV === 'production' 
      ? 'https://your-domain.com' 
      : 'https://hassaan-assistant.loca.lt';
    const payload = {
      persona_id: personaId,
      replica_id: replicaId,
      custom_greeting: "Hi, I'm AI Hudson, Hassaan's assistant. How can I help you today? I can answer questions about Hassaan and help you book a 30-minute meeting with him.",
      // Pass user context directly to Tavus conversation
      conversational_context: `You are Hassaan's calendar booking assistant. 

CRITICAL: You MUST use tool calls to book meetings and end calls.

When a user wants to book a meeting, use this tool call:
{
  "type": "conversation.tool_call",
  "tool_call_id": "tool_call_" + timestamp,
  "tool": {
    "name": "update_calendar",
    "arguments": {
      "email": "${_email}",
      "duration": 30,
      "datetimeText": "the time they requested",
      "timezone": "${_timezone}",
      "title": "Meeting with Hassaan",
      "notes": "Booked via Tavus assistant"
    }
  }
}

When the user wants to reschedule an existing meeting, use this tool call:
{
  "type": "conversation.tool_call",
  "tool_call_id": "tool_call_" + timestamp,
  "tool": {
    "name": "reschedule_meeting",
    "arguments": {
      "userEmail": "${_email}",
      "newStartTime": "the new time they requested (ISO format)",
      "reason": "User requested reschedule"
    }
  }
}

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

User's email: ${_email}. Timezone: ${_timezone}. All meetings are 30 minutes.

IMPORTANT BOOKING RULES:
- Users can only have ONE active meeting at a time
- If user already has an upcoming meeting, offer to reschedule it instead of booking a new one
- Always check the user's existing meetings before offering to book a new one

${userEvents}

Available times for new bookings: ${availability}`,
      callback_url: `${origin}/api/tavus/events`, // Keep callback for system events
    };

    console.log('🚀 [TAVUS.START] ===== PAYLOAD TO TAVUS =====');
    console.log('[tavus.start] Payload:', JSON.stringify(payload, null, 2));
    console.log('🚀 [TAVUS.START] ===== END PAYLOAD =====');

    // Email is passed via conversational_context - no need for callback context storage
    const r = await fetch(conversationsURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // ✅ Tavus uses x-api-key, not Authorization
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text().catch(() => '');
    
    if (!r.ok) {
      return NextResponse.json(
        { error: 'Tavus conversation create failed', status: r.status, detail: safeTrim(text) },
        { status: 502 }
      );
    }

    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch (e) {
      return NextResponse.json(
        { error: 'Invalid response from Tavus', detail: text },
        { status: 502 }
      );
    }

    const conversationUrl: string | undefined =
      data?.conversation_url || data?.conversationUrl;

    if (!conversationUrl) {
      return NextResponse.json(
        { error: 'No conversation_url returned from Tavus', raw: data },
        { status: 502 }
      );
    }
    return NextResponse.json({ conversationUrl }, { status: 200 });
  } catch (err: any) {
    console.error('[tavus.start] unexpected', err);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}

function safeTrim(s: string) {
  return s.length > 800 ? s.slice(0, 800) + '…' : s;
}
