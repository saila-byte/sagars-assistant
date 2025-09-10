#!/bin/bash

# Test script to create a Gmail calendar invite using your existing /api/book endpoint
# This tests the same functionality that should be triggered by Tavus tool calls

# Configuration
BASE_URL="http://localhost:3000"
EMAIL="test@example.com"
TITLE="Test Meeting with Sagar"
NOTES="Test meeting created via API"
DURATION=15
START_TIME="2024-01-15T10:00:00-08:00"  # ISO format with timezone

echo "Testing Gmail calendar invite via /api/book endpoint..."
echo "Email: $EMAIL"
echo "Title: $TITLE"
echo "Start: $START_TIME"
echo "Duration: $DURATION minutes"
echo ""

# Test the booking API endpoint
echo "Calling POST $BASE_URL/api/book"
curl -X POST "$BASE_URL/api/book" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "'"$EMAIL"'",
    "start_time": "'"$START_TIME"'",
    "duration": '"$DURATION"',
    "title": "'"$TITLE"'",
    "notes": "'"$NOTES"'"
  }' | jq '.'

echo ""
echo "Check the response above for:"
echo "- Event ID"
echo "- HTML link to the event"
echo "- Google Meet link"
echo "- Any error messages"
echo ""
echo "If successful, the attendee should receive a Gmail invitation."
