import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Callback endpoint for Tavus tool calls

export async function POST(req: Request) {
  try {
    console.log('🔔 [TAVUS.EVENTS] ===== CALLBACK RECEIVED =====');
    console.log('[tavus.events] Timestamp:', new Date().toISOString());
    const host = req.headers.get('host') || 'localhost:3000';
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const fullUrl = `${protocol}://${host}${req.url}`;
    console.log('[tavus.events] URL:', fullUrl);
    console.log('[tavus.events] Method:', req.method);
    
    const body = await req.json().catch((e) => {
      console.error('[tavus.events] Failed to parse JSON:', e);
      return {};
    });
    console.log('[tavus.events] Full callback body:', JSON.stringify(body, null, 2));
    console.log('[tavus.events] Body type:', typeof body);
    console.log('[tavus.events] Body keys:', Object.keys(body || {}));
    
    // Log headers for debugging
    const headers = Object.fromEntries(req.headers.entries());
    console.log('[tavus.events] Headers:', headers);
    console.log('[tavus.events] Content-Type:', req.headers.get('content-type'));
    console.log('[tavus.events] User-Agent:', req.headers.get('user-agent'));
    
    // Check if this is a tool call
    const isToolCall = 
      body.type === 'conversation.tool_call' ||
      body.event_type === 'conversation.tool_call' ||
      body.tool_call ||
      body.tool ||
      body.name === 'update_calendar' ||
      body.name === 'end_call';
    
    console.log('🔔 [TAVUS.EVENTS] ===== TOOL CALL CHECK =====');
    console.log('[tavus.events] Is tool call?', isToolCall);
    console.log('[tavus.events] Check details:', {
      'body.type': body.type,
      'body.event_type': body.event_type,
      'body.tool_call': !!body.tool_call,
      'body.tool': !!body.tool,
      'body.name': body.name
    });
    
    if (isToolCall) {
      console.log('🔧 [TAVUS.EVENTS] ===== TOOL CALL DETECTED =====');
      console.log('[tavus.events] Tool call details:', {
        type: body.type,
        event_type: body.event_type,
        tool_call_id: body.tool_call_id,
        tool: body.tool,
        tool_call: body.tool_call,
        name: body.name,
        arguments: body.arguments,
        parameters: body.parameters
      });
      
      // If this is an update_calendar tool call, forward to booking API
      
      const toolName = body.tool?.name || body.name;
      console.log('🔧 [TAVUS.EVENTS] ===== TOOL NAME EXTRACTION =====');
      console.log('[tavus.events] Tool name:', toolName);
      console.log('[tavus.events] From body.tool?.name:', body.tool?.name);
      console.log('[tavus.events] From body.name:', body.name);
      
      if (toolName === 'update_calendar') {
        const args = body.tool?.arguments || body.arguments || body.parameters || {};
        console.log('🔧 [TAVUS.EVENTS] ===== UPDATE_CALENDAR TOOL CALL =====');
        console.log('[tavus.events] Processing update_calendar tool call with args:', args);
        console.log('[tavus.events] Args type:', typeof args);
        console.log('[tavus.events] Args stringified:', JSON.stringify(args, null, 2));
        
        // Check for existing meetings with Hassan before booking
        try {
          if (args.email) {
            console.log('[tavus.events] Checking for existing meetings with user:', args.email);
            
            // Use the existing test-user-events API to check for existing meetings
            const host = req.headers.get('host') || 'localhost:3000';
            const protocol = req.headers.get('x-forwarded-proto') || 'https';
            const baseUrl = `${protocol}://${host}`;
            
            const userEventsResponse = await fetch(`${baseUrl}/api/test-user-events?email=${encodeURIComponent(args.email)}`, {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' }
            });
            
            if (userEventsResponse.ok) {
              const userEventsData = await userEventsResponse.json();
              const meetingCount = userEventsData.totalEvents || 0;
              console.log('[tavus.events] Found existing meetings count:', meetingCount);
              console.log('[tavus.events] User events data:', JSON.stringify(userEventsData, null, 2));
              
              if (meetingCount > 1) {
                console.log('[tavus.events] ⚠️ BLOCKING BOOKING: User has more than 1 existing meeting, processing as update instead of booking new meeting');
                
                // Successfully processed update_calendar tool call - user has existing meetings
                return NextResponse.json({ 
                  success: true,
                  message: 'Calendar update processed - user has existing meetings',
                  tool_call_id: body.tool_call_id || body.tool?.tool_call_id,
                  action_taken: 'update_calendar_processed',
                  existing_meetings_count: meetingCount
                });
              } else {
                console.log('[tavus.events] ✅ PROCEEDING WITH BOOKING: User has', meetingCount, 'existing meetings (≤1), allowing new booking');
              }
            } else {
              console.log('[tavus.events] ⚠️ Failed to fetch user events, proceeding with booking anyway');
            }
          }
        } catch (error) {
          console.error('[tavus.events] Error checking existing meetings:', error);
          // Continue with booking if we can't check existing meetings
        }
        
        // Forward the tool call to the booking API
        try {
          const host = req.headers.get('host') || 'localhost:3000';
          const protocol = req.headers.get('x-forwarded-proto') || 'https';
          const baseUrl = `${protocol}://${host}`;
          const bookingResponse = await fetch(`${baseUrl}/api/tavus/intent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              intent: 'BOOK_MEETING',
              email: args.email,
              duration: 30, // Only 30-minute meetings
              datetimeText: args.datetimeText || args.when,
              timezone: args.timezone,
              confirm: true,
              title: args.title || 'Meeting with Hassaan',
              notes: args.notes || 'Booked via Tavus assistant'
            })
          });
          
          const bookingData = await bookingResponse.json();
          console.log('[tavus.events] Booking response:', bookingData);
          
          return NextResponse.json({ 
            success: true, 
            message: 'Tool call processed and booking created',
            tool_call_id: body.tool_call_id || body.tool?.tool_call_id,
            booking_result: bookingData
          });
        } catch (error) {
          console.error('[tavus.events] Error processing booking:', error);
          return NextResponse.json({ 
            success: false, 
            message: 'Error processing booking',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } else if (toolName === 'reschedule_meeting') {
        const args = body.tool?.arguments || body.arguments || body.parameters || {};
        console.log('🔧 [TAVUS.EVENTS] ===== RESCHEDULE_MEETING TOOL CALL =====');
        console.log('[tavus.events] Processing reschedule_meeting tool call with args:', args);
        
        // Forward the tool call to the reschedule API
        try {
          const host = req.headers.get('host') || 'localhost:3000';
          const protocol = req.headers.get('x-forwarded-proto') || 'https';
          const baseUrl = `${protocol}://${host}`;
          const rescheduleResponse = await fetch(`${baseUrl}/api/reschedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userEmail: args.userEmail,
              newStartTime: args.newStartTime,
              reason: args.reason || 'User requested reschedule'
            })
          });
          
          const rescheduleData = await rescheduleResponse.json();
          console.log('[tavus.events] Reschedule response:', rescheduleData);
          
          return NextResponse.json({ 
            success: true, 
            message: 'Tool call processed and meeting rescheduled',
            tool_call_id: body.tool_call_id || body.tool?.tool_call_id,
            reschedule_result: rescheduleData
          });
        } catch (error) {
          console.error('[tavus.events] Error processing reschedule:', error);
          return NextResponse.json({ 
            success: false, 
            message: 'Error processing reschedule',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } else if (toolName === 'end_call') {
        const args = body.tool?.arguments || body.arguments || body.parameters || {};
        console.log('[tavus.events] Processing end_call tool call with args:', args);
        
        // Handle call ending
        return NextResponse.json({ 
          success: true, 
          message: 'Call ended successfully',
          tool_call_id: body.tool_call_id || body.tool?.tool_call_id,
          reason: args.reason || 'user_completed_task'
        });
      }
      
      // For other tool calls, just log and return success
      return NextResponse.json({ 
        success: true, 
        message: 'Tool call received and logged',
        tool_call_id: body.tool_call_id || body.tool?.tool_call_id
      });
    } else {
      console.log('[tavus.events] Non-tool-call event received:', body);
      return NextResponse.json({ 
        success: true, 
        message: 'Event received and logged',
        event_type: body.type || body.event_type
      });
    }
    
  } catch (error: unknown) {
    console.error('[tavus.events] Error processing callback:', error);
    return NextResponse.json(
      { error: 'Failed to process callback', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Also handle GET requests for health checks
export async function GET() {
  console.log('[tavus.events] Health check received');
  return NextResponse.json({ 
    status: 'healthy', 
    endpoint: '/api/tavus/events',
    timestamp: new Date().toISOString()
  });
}
