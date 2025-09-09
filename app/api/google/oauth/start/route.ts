import { NextResponse } from 'next/server';
import { google } from 'googleapis';

export const runtime = 'nodejs';

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI!;
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: 'Missing GOOGLE_* env vars' }, { status: 500 });
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const scopes = ['https://www.googleapis.com/auth/calendar'];
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });
  return NextResponse.redirect(url);
}
