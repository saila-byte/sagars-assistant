# Vercel OAuth Setup Guide

This guide will help you set up OAuth tokens for your Vercel deployment to fix the 401 Unauthorized error.

## The Problem

The 401 error occurs because OAuth tokens are stored in a local `.google-tokens.json` file, which doesn't exist on Vercel's serverless functions. Each function invocation is stateless and doesn't have access to persistent file storage.

## Solution

We've updated the code to use environment variables as a fallback for Vercel deployments. You need to set the OAuth tokens as environment variables on Vercel.

## Method 1: Automated Setup (Recommended)

Run the setup script:

```bash
./setup-vercel-oauth.sh
```

This script will:
1. Extract tokens from your local `.google-tokens.json` file
2. Set them as environment variables on Vercel
3. Provide instructions for redeployment

## Method 2: Manual Setup

### Step 1: Get Your Current Tokens

```bash
cat .google-tokens.json
```

### Step 2: Set Environment Variables on Vercel

You can set these via:
- Vercel Dashboard: Project Settings → Environment Variables
- Vercel CLI: `vercel env add`

Required environment variables:

```bash
GOOGLE_ACCESS_TOKEN=your_access_token_here
GOOGLE_REFRESH_TOKEN=your_refresh_token_here
GOOGLE_TOKEN_EXPIRY=your_expiry_timestamp_here
GOOGLE_TOKEN_TYPE=Bearer
GOOGLE_TOKEN_SCOPE=https://www.googleapis.com/auth/calendar
```

### Step 3: Redeploy

```bash
vercel --prod
```

## Method 3: Using Vercel CLI

```bash
# Set each environment variable
vercel env add GOOGLE_ACCESS_TOKEN
vercel env add GOOGLE_REFRESH_TOKEN
vercel env add GOOGLE_TOKEN_EXPIRY
vercel env add GOOGLE_TOKEN_TYPE
vercel env add GOOGLE_TOKEN_SCOPE

# Redeploy
vercel --prod
```

## Verification

After setting up the environment variables and redeploying:

1. Check that the environment variables are set:
   ```bash
   vercel env ls
   ```

2. Test the OAuth status endpoint:
   ```bash
   curl https://your-vercel-app.vercel.app/api/google/oauth/status
   ```

3. Test the booking endpoint:
   ```bash
   curl -X POST https://your-vercel-app.vercel.app/api/book \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","start_time":"2025-09-20T16:00:00Z"}'
   ```

## Important Notes

- **Token Expiry**: Access tokens expire after 1 hour. The refresh token is used to get new access tokens automatically.
- **Refresh Token**: The refresh token doesn't expire and is the most important part to keep secure.
- **Security**: These tokens give access to your Google Calendar. Keep them secure and don't commit them to version control.
- **Updates**: When tokens are refreshed, you'll need to update the environment variables on Vercel.

## Troubleshooting

### Still getting 401 errors?
1. Verify environment variables are set: `vercel env ls`
2. Check that the refresh token is valid
3. Ensure you've redeployed after setting the variables
4. Check Vercel function logs for detailed error messages

### Token refresh issues?
1. The refresh token might be invalid
2. Re-run the OAuth flow locally to get fresh tokens
3. Update the environment variables with the new tokens

## Code Changes Made

The following changes were made to support Vercel deployment:

1. **Updated `lib/googleTokens.ts`**:
   - Added Vercel detection (`process.env.VERCEL === '1'`)
   - Added fallback to environment variables when no file tokens exist
   - Added `getTokensFromEnv()` function to parse tokens from environment variables

2. **Created setup scripts**:
   - `setup-vercel-oauth.sh` - Automated setup script
   - `VERCEL_OAUTH_SETUP.md` - This documentation

This solution ensures your OAuth works both locally (using file storage) and on Vercel (using environment variables).
