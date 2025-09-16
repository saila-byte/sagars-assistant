import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { conversation_id } = await req.json();

    if (!conversation_id) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 });
    }

    console.log('🔚 [END_CONVERSATION] Ending conversation:', conversation_id);

    const response = await fetch(`https://tavusapi.com/v2/conversations/${conversation_id}/end`, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.TAVUS_API_KEY!,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('🔚 [END_CONVERSATION] Tavus API error:', response.status, errorText);
      return NextResponse.json(
        { error: `Failed to end conversation: ${response.statusText}` },
        { status: response.status }
      );
    }

    // Handle empty response or non-JSON response
    const contentType = response.headers.get('content-type');
    let result = null;
    
    if (contentType && contentType.includes('application/json')) {
      try {
        result = await response.json();
      } catch (jsonError) {
        console.warn('🔚 [END_CONVERSATION] Could not parse JSON response:', jsonError);
      }
    } else {
      const textResponse = await response.text();
      console.log('🔚 [END_CONVERSATION] Non-JSON response:', textResponse);
    }

    console.log('🔚 [END_CONVERSATION] Conversation ended successfully:', result);

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('🔚 [END_CONVERSATION] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
