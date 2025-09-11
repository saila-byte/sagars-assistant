#!/bin/bash

echo "🔐 Google OAuth Setup for Hassaan's Assistant"
echo "=========================================="
echo ""

# Check if server is running
if ! curl -s http://localhost:3000/api/google/oauth/status > /dev/null; then
    echo "❌ Server not running. Please start with: npm run dev"
    exit 1
fi

echo "✅ Server is running"
echo ""

# Check current OAuth status
echo "📊 Checking current OAuth status..."
STATUS=$(curl -s http://localhost:3000/api/google/oauth/status)
echo "$STATUS" | jq '.' 2>/dev/null || echo "$STATUS"
echo ""

# If not connected, provide instructions
if echo "$STATUS" | grep -q '"connected":false'; then
    echo "🔗 To connect Google OAuth:"
    echo "1. Open this URL in your browser:"
    echo "   http://localhost:3000/api/google/oauth/start"
    echo ""
    echo "2. Complete the Google OAuth flow"
    echo "3. Run this script again to verify connection"
    echo ""
    echo "💡 The OAuth tokens will be saved persistently and won't need re-authentication!"
else
    echo "✅ Google OAuth is already connected!"
    echo ""
    echo "🧪 Testing booking API..."
    curl -X POST "http://localhost:3000/api/book" \
         -H "Content-Type: application/json" \
         -d '{"email": "test@example.com", "start_time": "2025-09-11T20:00:00-07:00", "duration": 30, "title": "Test Meeting"}' \
         | jq '.' 2>/dev/null || echo "Booking test completed"
fi
