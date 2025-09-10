import { promises as fs } from 'fs';
import path from 'path';
import { google } from 'googleapis';

const TOKENS_FILE = path.join(process.cwd(), '.google-tokens.json');

export async function setTokens(t: any) {
  try {
    await fs.writeFile(TOKENS_FILE, JSON.stringify(t, null, 2));
    console.log('[googleTokens] Tokens saved to file');
  } catch (error) {
    console.error('[googleTokens] Error saving tokens:', error);
  }
}

export async function getTokens() {
  try {
    const data = await fs.readFile(TOKENS_FILE, 'utf8');
    const tokens = JSON.parse(data);
    console.log('[googleTokens] Tokens loaded from file');
    return tokens;
  } catch (error) {
    console.log('[googleTokens] No tokens file found or error reading:', error.message);
    return null;
  }
}

export async function clearTokens() {
  try {
    await fs.unlink(TOKENS_FILE);
    console.log('[googleTokens] Tokens file deleted');
  } catch (error) {
    console.log('[googleTokens] No tokens file to delete');
  }
}

// New function to get valid tokens with automatic refresh
export async function getValidTokens() {
  try {
    const tokens = await getTokens();
    if (!tokens) {
      console.log('[googleTokens] No tokens found');
      return null;
    }

    // Check if token is expired
    const now = Date.now();
    const isExpired = tokens.expiry_date && tokens.expiry_date < now;
    
    if (!isExpired) {
      console.log('[googleTokens] Tokens are still valid');
      return tokens;
    }

    // Token is expired, try to refresh
    if (tokens.refresh_token) {
      console.log('[googleTokens] Token expired, attempting refresh...');
      
      const clientId = process.env.GOOGLE_CLIENT_ID!;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI!;
      
      if (!clientId || !clientSecret || !redirectUri) {
        console.error('[googleTokens] Missing OAuth environment variables');
        return null;
      }

      const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      oauth2.setCredentials(tokens);

      try {
        const { credentials } = await oauth2.refreshAccessToken();
        console.log('[googleTokens] Token refreshed successfully');
        
        // Save the new tokens
        await setTokens(credentials);
        return credentials;
      } catch (refreshError) {
        console.error('[googleTokens] Token refresh failed:', refreshError);
        return null;
      }
    } else {
      console.log('[googleTokens] No refresh token available, re-authentication needed');
      return null;
    }
  } catch (error) {
    console.error('[googleTokens] Error getting valid tokens:', error);
    return null;
  }
}
