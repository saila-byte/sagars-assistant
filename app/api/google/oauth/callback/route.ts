import { NextResponse } from 'next/server';
import { oauthClient, saveRefreshToken } from '@/lib/google';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'missing code' }, { status: 400 });

  try {
    const oauth2 = oauthClient();
    const { tokens } = await oauth2.getToken(code);
    
    if (!tokens.refresh_token) {
      return new NextResponse(
        `<html><body style="font:14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h3>❌ Authentication Error</h3>
          <p>No refresh token received. Please try again and make sure to grant all permissions.</p>
          <p><a href="/api/google/oauth/start">Try Again</a></p>
        </body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Save only the refresh token - Google SDK will handle access token refresh
    await saveRefreshToken(tokens.refresh_token);

    // Check if we're on Vercel
    const isVercel = process.env.VERCEL === '1';
    
    if (isVercel) {
      // On Vercel, provide instructions for setting the refresh token
      return new NextResponse(
        `<html><body style="font:14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px;">
          <h3>Google Calendar connected ✅</h3>
          <p><strong>Important for Vercel deployment:</strong></p>
          <p>Set this environment variable in your Vercel dashboard:</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0; font-family: monospace; font-size: 12px; overflow-x: auto; word-break: break-all;">
            <div><strong>GOOGLE_REFRESH_TOKEN</strong></div>
            <div>${tokens.refresh_token}</div>
          </div>
          <p><strong>Steps:</strong></p>
          <ol>
            <li>Go to <a href="https://vercel.com/dashboard" target="_blank">Vercel Dashboard</a></li>
            <li>Select your project → Settings → Environment Variables</li>
            <li>Add <code>GOOGLE_REFRESH_TOKEN</code> with the value above</li>
            <li>Redeploy your app</li>
          </ol>
          <p><strong>That's it!</strong> The Google SDK will automatically refresh access tokens as needed.</p>
          <p>You can close this tab after setting the environment variable.</p>
        </body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    } else {
      // Local development
      return new NextResponse(
        `<html><body style="font:14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
          <h3>Google Calendar connected ✅</h3>
          <p>Refresh token saved. The Google SDK will automatically refresh access tokens as needed.</p>
          <p>You can close this tab.</p>
        </body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }
  } catch (error) {
    console.error('[oauth/callback] Error:', error);
    return new NextResponse(
      `<html><body style="font:14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
        <h3>❌ Authentication Error</h3>
        <p>Failed to authenticate with Google. Please try again.</p>
        <p><a href="/api/google/oauth/start">Try Again</a></p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}
