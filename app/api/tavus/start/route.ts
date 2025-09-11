// app/api/tavus/start/route.ts
import { NextResponse } from 'next/server';

type StartBody = {
  email?: string;       // kept for later use if you want to pass context
  duration?: number;    // kept for later use
  timezone?: string;    // kept for later use
};

// Helper function to fetch calendar availability
async function fetchAvailability(timezone: string): Promise<string> {
  try {
    const origin = process.env.NODE_ENV === 'production'
      ? 'https://your-domain.com'
      : 'https://sagar-assistant.loca.lt';
    
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

    // --- Fetch availability and build context ---
    const availability = await fetchAvailability(_timezone);
    
    // --- Minimal payload to isolate auth/IDs (matches your working curl shape) ---
    const origin = process.env.NODE_ENV === 'production' 
      ? 'https://your-domain.com' 
      : 'https://sagar-assistant.loca.lt';
    const payload = {
      persona_id: personaId,
      replica_id: replicaId,
      // Pass user context directly to Tavus conversation
      conversational_context: `You are Sagar's calendar booking assistant. 

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
      "title": "Meeting with Sagar",
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

User's email: ${_email}. Timezone: ${_timezone}. All meetings are 30 minutes. ${availability}`,
      callback_url: `${origin}/api/tavus/events`, // Keep callback for system events
    };

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
