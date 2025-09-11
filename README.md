# Sagar's Assistant - AI Calendar Booking App

An AI-powered calendar booking assistant built with Next.js, Tavus AI, and Google Calendar API. Users can book 30-minute meetings with Sagar through a conversational AI avatar.

## Features

- 🤖 **AI Avatar**: Interactive Tavus AI avatar for natural conversation
- 📅 **Calendar Integration**: Automatic Google Calendar event creation
- 📧 **Email Invites**: Gmail calendar invites sent automatically
- ⏰ **30-Minute Meetings**: Fixed duration for consistent scheduling
- 🔄 **Auto-Refresh**: OAuth tokens refresh automatically
- 🎯 **Tool Calling**: AI avatar can book meetings and end calls

## Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd sagars-assistant
npm install
```

### 2. Set Up Environment Variables

Create `.env.local` with your API keys:

```bash
# Google OAuth (required)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/oauth/callback
SAGAR_CALENDAR_ID=primary

# Tavus AI (required)
TAVUS_API_KEY=your_tavus_api_key
TAVUS_PERSONA_ID=your_persona_id
TAVUS_REPLICA_ID=your_replica_id

# Calendly (optional)
CALENDLY_TOKEN=your_calendly_token
CALENDLY_EVENT_TYPE_30_URI=your_30min_event_type_uri
```

### 3. Set Up Google OAuth

**Option A: Automated Setup**
```bash
./setup-google-oauth.sh
```

**Option B: Manual Setup**
1. Follow the detailed guide in [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md)
2. Visit `http://localhost:3000/api/google/oauth/start` to authenticate

### 4. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## How It Works

1. **User Input**: User enters email and starts conversation with AI avatar
2. **AI Conversation**: Tavus avatar handles natural language booking requests
3. **Tool Calling**: Avatar uses `update_calendar` tool to book meetings
4. **Calendar Creation**: Google Calendar API creates events with Gmail invites
5. **Call Management**: Avatar can end calls when user is done

## API Endpoints

- `POST /api/tavus/start` - Start conversation with AI avatar
- `POST /api/book` - Create calendar event directly
- `GET /api/google/oauth/start` - Begin Google OAuth flow
- `GET /api/google/oauth/status` - Check OAuth connection status
- `POST /api/tavus/events` - Handle Tavus webhook events

## Project Structure

```
app/
├── api/
│   ├── book/           # Calendar booking API
│   ├── google/oauth/   # Google OAuth flow
│   ├── tavus/          # Tavus AI integration
│   └── calendly/       # Availability checking
├── components/         # React components
└── page.tsx           # Main app interface
```

## Troubleshooting

- **OAuth Issues**: See [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md)
- **Tool Calls Not Working**: Check Tavus platform configuration
- **Calendar Invites**: Verify `sendUpdates: 'all'` in booking API
- **Token Refresh**: App automatically refreshes expired tokens

## Development

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
