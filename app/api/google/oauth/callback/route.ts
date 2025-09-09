import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { setTokens } from '@/lib/googleTokens';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'missing code' }, { status: 400 });

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI!;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const { tokens } = await oauth2.getToken(code);
  setTokens(tokens);

  return new NextResponse(
    `<html><body style="font:14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
      <h3>Google Calendar connected ✅</h3>
      <p>You can close this tab.</p>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}
