import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

/**
 * Creates a new OAuth2 client with environment variables
 */
export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  );
}

/**
 * Creates a Calendar API client from a refresh token
 * The Google SDK will automatically refresh access tokens as needed
 */
export function calendarFromRefresh(refreshToken: string) {
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  // Google SDK will auto-refresh access tokens under the hood
  return google.calendar({ version: 'v3', auth: client });
}

/**
 * Creates a Calendar API client from stored credentials
 * Works for both local development (file) and Vercel (env vars)
 */
export async function getCalendarClient() {
  // Try to get refresh token from environment variables first (Vercel)
  const envRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (envRefreshToken) {
    console.log('[google] Using refresh token from environment variables');
    return calendarFromRefresh(envRefreshToken);
  }

  // Fallback to file-based storage (local development)
  try {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const tokensFile = path.join(process.cwd(), '.google-tokens.json');
    const data = await fs.readFile(tokensFile, 'utf8');
    const tokens = JSON.parse(data);
    
    if (tokens.refresh_token) {
      console.log('[google] Using refresh token from file');
      return calendarFromRefresh(tokens.refresh_token);
    }
  } catch (error) {
    console.log('[google] No file-based tokens found:', error instanceof Error ? error.message : String(error));
  }

  throw new Error('No valid refresh token found. Please authenticate first.');
}

/**
 * Saves tokens after OAuth callback
 * Only saves the refresh token as it's the only one we need to persist
 */
export async function saveRefreshToken(refreshToken: string) {
  const tokens = { refresh_token: refreshToken };
  
  // Save to file for local development
  if (process.env.NODE_ENV === 'development') {
    try {
      const { promises: fs } = await import('fs');
      const path = await import('path');
      const tokensFile = path.join(process.cwd(), '.google-tokens.json');
      await fs.writeFile(tokensFile, JSON.stringify(tokens, null, 2));
      console.log('[google] Refresh token saved to file');
    } catch (error) {
      console.error('[google] Error saving refresh token to file:', error);
    }
  }
  
  // For production, the refresh token should be set as an environment variable
  console.log('[google] Refresh token obtained. For production, set GOOGLE_REFRESH_TOKEN environment variable to:', refreshToken);
}
