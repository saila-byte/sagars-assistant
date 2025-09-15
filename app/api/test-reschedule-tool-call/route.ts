import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    console.log('🧪 [TEST] Testing reschedule tool call...');
    
    // Simulate a reschedule tool call
    const toolCallBody = {
      type: 'conversation.tool_call',
      tool_call_id: 'tool_call_test_' + Date.now(),
      tool: {
        name: 'reschedule_meeting',
        arguments: {
          userEmail: 'sailakath@gmail.com',
          newStartTime: '2025-09-13T15:00:00Z',
          reason: 'Test reschedule from tool call'
        }
      }
    };
    
    console.log('🧪 [TEST] Sending tool call to events handler:', JSON.stringify(toolCallBody, null, 2));
    
    // Forward to the events handler
    const host = req.headers.get('host') || 'localhost:3000';
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const baseUrl = `${protocol}://${host}`;
    
    const response = await fetch(`${baseUrl}/api/tavus/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toolCallBody)
    });
    
    const result = await response.json();
    
    return NextResponse.json({
      success: true,
      toolCallBody,
      response: result,
      status: response.status
    });
    
  } catch (error: unknown) {
    console.error('🧪 [TEST] Error:', error);
    return NextResponse.json({
      error: (error as Error)?.message || 'Unknown error',
      details: error.toString()
    }, { status: 500 });
  }
}
