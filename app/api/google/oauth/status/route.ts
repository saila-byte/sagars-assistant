import { NextResponse } from 'next/server';
import { getTokens } from '@/lib/googleTokens';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const tokens = await getTokens();
    
    if (!tokens) {
      return NextResponse.json({
        connected: false,
        message: 'Google OAuth not connected',
        action: 'Visit /api/google/oauth/start to authenticate'
      });
    }

    // Check if token is expired
    const now = Date.now();
    const isExpired = tokens.expiry_date && tokens.expiry_date < now;
    
    return NextResponse.json({
      connected: true,
      expired: isExpired,
      tokenType: tokens.token_type,
      scope: tokens.scope,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      message: isExpired ? 'Token expired - re-authentication needed' : 'Google OAuth connected and active'
    });
  } catch (error: any) {
    return NextResponse.json({
      connected: false,
      error: error.message,
      message: 'Error checking OAuth status'
    }, { status: 500 });
  }
}
