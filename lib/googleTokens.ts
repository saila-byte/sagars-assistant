import { promises as fs } from 'fs';
import path from 'path';
import { google } from 'googleapis';

const TOKENS_FILE = path.join(process.cwd(), '.google-tokens.json');

// For Vercel deployment, we'll use environment variables as fallback
const isVercel = process.env.VERCEL === '1';

export async function setTokens(t: Record<string, unknown>) {
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
    console.log('[googleTokens] No tokens file found or error reading:', error instanceof Error ? error.message : String(error));
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
    let tokens = await getTokens();
    
    // If no tokens from file and we're on Vercel, try to get from environment variables
    if (!tokens && isVercel) {
      console.log('[googleTokens] No tokens file found, checking environment variables for Vercel...');
      const envTokens = getTokensFromEnv();
      if (envTokens) {
        tokens = envTokens;
        console.log('[googleTokens] Using tokens from environment variables');
      }
    }
    
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
        
        // Save the new tokens (only if not on Vercel)
        if (!isVercel) {
          await setTokens(credentials);
        } else {
          console.log('[googleTokens] On Vercel - tokens refreshed but not saved to file');
        }
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

// Helper function to get tokens from environment variables (for Vercel)
function getTokensFromEnv() {
  try {
    const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    const expiryDate = process.env.GOOGLE_TOKEN_EXPIRY;
    const tokenType = process.env.GOOGLE_TOKEN_TYPE || 'Bearer';
    const scope = process.env.GOOGLE_TOKEN_SCOPE;

    if (!accessToken || !refreshToken) {
      console.log('[googleTokens] Missing required token environment variables');
      return null;
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: expiryDate ? parseInt(expiryDate) : undefined,
      token_type: tokenType,
      scope: scope
    };
  } catch (error) {
    console.error('[googleTokens] Error parsing tokens from environment:', error);
    return null;
  }
}
