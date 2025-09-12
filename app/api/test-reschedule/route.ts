import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userEmail = searchParams.get('email') || 'test@example.com';
    
    // Generate a future time (tomorrow at 2 PM)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0); // 2 PM tomorrow
    const newTime = tomorrow.toISOString();
    
    console.log('🧪 [TEST] Testing reschedule for:', { userEmail, newTime });
    
    // Test the reschedule API
    const rescheduleResponse = await fetch('http://localhost:3001/api/reschedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userEmail,
        newStartTime: newTime,
        reason: 'Test reschedule from API'
      })
    });
    
    const rescheduleData = await rescheduleResponse.json();
    
    return NextResponse.json({
      success: true,
      testEmail: userEmail,
      newTime,
      rescheduleResponse: rescheduleData,
      status: rescheduleResponse.status
    });

  } catch (error: unknown) {
    console.error('🧪 [TEST] Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: String(error)
    }, { status: 500 });
  }
}
