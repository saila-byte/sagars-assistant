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
  await setTokens(tokens as Record<string, unknown>);

  // Check if we're on Vercel
  const isVercel = process.env.VERCEL === '1';
  
  if (isVercel) {
    // On Vercel, provide instructions for setting environment variables
    return new NextResponse(
      `<html><body style="font:14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px;">
        <h3>Google Calendar connected ✅</h3>
        <p><strong>Important for Vercel deployment:</strong></p>
        <p>To fix the 401 error on Vercel, you need to set these environment variables:</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0; font-family: monospace; font-size: 12px; overflow-x: auto;">
          <div>GOOGLE_ACCESS_TOKEN=${tokens.access_token}</div>
          <div>GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}</div>
          <div>GOOGLE_TOKEN_EXPIRY=${tokens.expiry_date}</div>
          <div>GOOGLE_TOKEN_TYPE=${tokens.token_type}</div>
          <div>GOOGLE_TOKEN_SCOPE=${tokens.scope}</div>
        </div>
        <p><strong>Quick setup:</strong></p>
        <ol>
          <li>Run: <code>./setup-vercel-oauth.sh</code> (if you have the script)</li>
          <li>Or manually set these in Vercel Dashboard → Project Settings → Environment Variables</li>
          <li>Redeploy your Vercel app</li>
        </ol>
        <p><a href="https://vercel.com/dashboard" target="_blank">Open Vercel Dashboard</a></p>
        <p>You can close this tab after setting the environment variables.</p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  } else {
    // Local development
    return new NextResponse(
      `<html><body style="font:14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
        <h3>Google Calendar connected ✅</h3>
        <p>You can close this tab.</p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}
