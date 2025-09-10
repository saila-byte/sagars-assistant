import { promises as fs } from 'fs';
import path from 'path';

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
