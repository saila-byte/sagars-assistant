import { NextResponse } from 'next/server';
import { setTokens, getTokens } from '@/lib/googleTokens';

export const runtime = 'nodejs';

// GET: Check current token status
export async function GET() {
  const tokens = await getTokens();
  return NextResponse.json({
    hasTokens: !!tokens,
    tokenType: tokens?.token_type,
    expiresAt: tokens?.expiry_date,
    scope: tokens?.scope
  });
}

// POST: Set test tokens (for debugging)
export async function POST(req: Request) {
  try {
    const { access_token, refresh_token } = await req.json();
    
    if (!access_token) {
      return NextResponse.json({ error: 'access_token required' }, { status: 400 });
    }
    
    // Set tokens manually for testing
    await setTokens({
      access_token,
      refresh_token,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/calendar',
      expiry_date: Date.now() + 3600000 // 1 hour from now
    });
    
    const currentTokens = await getTokens();
    return NextResponse.json({ 
      success: true, 
      message: 'Tokens set manually',
      hasTokens: !!currentTokens
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
