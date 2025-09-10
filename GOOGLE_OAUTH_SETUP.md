# Google OAuth Setup Guide

This guide will help you set up Google OAuth authentication for the Sagar's Assistant calendar booking app.

## Prerequisites

- A Google account
- Access to Google Cloud Console
- Node.js and npm installed

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Enter project name: `sagar-assistant` (or any name you prefer)
4. Click "Create"

## Step 2: Enable Google Calendar API

1. In your Google Cloud project, go to "APIs & Services" → "Library"
2. Search for "Google Calendar API"
3. Click on it and press "Enable"

## Step 3: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth 2.0 Client IDs"
3. If prompted, configure the OAuth consent screen:
   - Choose "External" user type
   - Fill in required fields:
     - App name: `Sagar's Assistant`
     - User support email: your email
     - Developer contact: your email
   - Add scopes: `https://www.googleapis.com/auth/calendar`
   - Add test users: your email address
4. For Application type, choose "Web application"
5. Add authorized redirect URIs:
   - `http://localhost:3000/api/google/oauth/callback` (for local development)
   - `https://your-domain.com/api/google/oauth/callback` (for production)
6. Click "Create"
7. Copy the **Client ID** and **Client Secret**

## Step 4: Set Environment Variables

Create a `.env.local` file in your project root:

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/oauth/callback

# Calendar ID (use 'primary' for your main calendar)
SAGAR_CALENDAR_ID=primary

# Tavus API (get from Tavus platform)
TAVUS_API_KEY=your_tavus_api_key
TAVUS_PERSONA_ID=your_persona_id
TAVUS_REPLICA_ID=your_replica_id

# Calendly (optional, for availability checking)
CALENDLY_TOKEN=your_calendly_token
CALENDLY_EVENT_TYPE_30_URI=your_30min_event_type_uri

# ElevenLabs (optional, for TTS)
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=your_voice_id
```

## Step 5: Authenticate with Google

1. Start your development server:
   ```bash
   npm run dev
   ```

2. Open your browser and go to:
   ```
   http://localhost:3000/api/google/oauth/start
   ```

3. You'll be redirected to Google's OAuth page:
   - Sign in with your Google account
   - Grant permission to access your Google Calendar
   - You'll be redirected back to your app

4. You should see a success message: "Google Calendar connected ✅"

## Step 6: Verify Authentication

Check if OAuth is working:

```bash
curl http://localhost:3000/api/google/oauth/status
```

You should see:
```json
{
  "connected": true,
  "expired": false,
  "tokenType": "Bearer",
  "scope": "https://www.googleapis.com/auth/calendar",
  "message": "Google OAuth connected and active with auto-refresh"
}
```

## Step 7: Test Calendar Booking

Test the booking functionality:

```bash
curl -X POST "http://localhost:3000/api/book" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "start_time": "2025-09-15T21:00:00Z",
    "duration": 30,
    "title": "Test Meeting",
    "notes": "Testing OAuth connection"
  }'
```

## Troubleshooting

### "Google not connected" Error
- Make sure you completed the OAuth flow at `/api/google/oauth/start`
- Check that your `.env.local` file has the correct credentials
- Verify the redirect URI matches exactly

### "Token expired" Error
- The app now has auto-refresh, but if it fails, re-authenticate:
  - Go to `/api/google/oauth/start` again
  - Or delete `.google-tokens.json` and re-authenticate

### "Invalid client" Error
- Check your Client ID and Client Secret in `.env.local`
- Make sure the redirect URI in Google Console matches your app

### "Access denied" Error
- Make sure you added your email as a test user in OAuth consent screen
- Check that the Google Calendar API is enabled

## Production Deployment

For production:

1. Update the redirect URI in Google Console to your production domain
2. Update `GOOGLE_REDIRECT_URI` in your production environment variables
3. Make sure your domain is added to authorized origins in Google Console

## Security Notes

- Never commit `.env.local` or `.google-tokens.json` to version control
- The refresh token allows long-term access - keep it secure
- Consider using environment-specific OAuth apps for dev/staging/prod

## Need Help?

If you encounter issues:
1. Check the browser console for errors
2. Check the terminal logs for detailed error messages
3. Verify all environment variables are set correctly
4. Make sure the Google Calendar API is enabled in your project
