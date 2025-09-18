import { NextResponse } from 'next/server';
import { oauthClient } from '@/lib/google';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const oauth2 = oauthClient();
    const scopes = ['https://www.googleapis.com/auth/calendar'];
    const url = oauth2.generateAuthUrl({
      access_type: 'offline', // Required to get refresh token
      scope: scopes,
      prompt: 'consent', // Force consent screen to ensure refresh token
    });
    return NextResponse.redirect(url);
  } catch (error) {
    console.error('[oauth/start] Error:', error);
    return NextResponse.json({ error: 'Missing GOOGLE_* environment variables' }, { status: 500 });
  }
}
