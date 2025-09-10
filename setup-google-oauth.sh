#!/bin/bash

echo "🔐 Google OAuth Setup for Sagar's Assistant"
echo "=========================================="
echo ""

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "❌ .env.local file not found!"
    echo "Please create .env.local with your Google OAuth credentials first."
    echo "See GOOGLE_OAUTH_SETUP.md for detailed instructions."
    exit 1
fi

echo "✅ .env.local file found"
echo ""

# Check if required environment variables are set
source .env.local

if [ -z "$GOOGLE_CLIENT_ID" ]; then
    echo "❌ GOOGLE_CLIENT_ID not set in .env.local"
    exit 1
fi

if [ -z "$GOOGLE_CLIENT_SECRET" ]; then
    echo "❌ GOOGLE_CLIENT_SECRET not set in .env.local"
    exit 1
fi

if [ -z "$GOOGLE_REDIRECT_URI" ]; then
    echo "❌ GOOGLE_REDIRECT_URI not set in .env.local"
    exit 1
fi

echo "✅ Required environment variables found"
echo ""

# Check if server is running
echo "🔍 Checking if development server is running..."
if curl -s http://localhost:3000/api/google/oauth/status > /dev/null 2>&1; then
    echo "✅ Development server is running on port 3000"
    PORT=3000
elif curl -s http://localhost:3001/api/google/oauth/status > /dev/null 2>&1; then
    echo "✅ Development server is running on port 3001"
    PORT=3001
else
    echo "❌ Development server is not running"
    echo "Please start the server with: npm run dev"
    exit 1
fi

echo ""
echo "🔐 Starting Google OAuth authentication..."
echo "This will open your browser to authenticate with Google."
echo ""

# Open OAuth URL
if command -v open > /dev/null; then
    open "http://localhost:$PORT/api/google/oauth/start"
elif command -v xdg-open > /dev/null; then
    xdg-open "http://localhost:$PORT/api/google/oauth/start"
else
    echo "Please open this URL in your browser:"
    echo "http://localhost:$PORT/api/google/oauth/start"
fi

echo ""
echo "⏳ Waiting for authentication to complete..."
echo "After you complete the OAuth flow, press Enter to check status..."

read -p "Press Enter to check OAuth status..."

echo ""
echo "🔍 Checking OAuth status..."

# Check OAuth status
STATUS_RESPONSE=$(curl -s "http://localhost:$PORT/api/google/oauth/status")
echo "$STATUS_RESPONSE" | jq . 2>/dev/null || echo "$STATUS_RESPONSE"

echo ""
echo "✅ OAuth setup complete!"
echo ""
echo "Next steps:"
echo "1. Test the booking API with a future time slot"
echo "2. Check your Google Calendar for test events"
echo "3. Start using the Tavus avatar for booking meetings"
echo ""
echo "For troubleshooting, see GOOGLE_OAUTH_SETUP.md"
