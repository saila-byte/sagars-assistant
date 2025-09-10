#!/bin/bash

# Test script to create a Gmail calendar invite using Google Calendar API
# This script demonstrates the same functionality as your /api/book endpoint

# Configuration - Update these with your actual values
GOOGLE_CLIENT_ID="your_google_client_id"
GOOGLE_CLIENT_SECRET="your_google_client_secret"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/google/oauth/callback"
CALENDAR_ID="primary"  # or your specific calendar ID
ACCESS_TOKEN="your_access_token"  # Get this from your OAuth flow

# Meeting details
EMAIL="test@example.com"
TITLE="Test Meeting with Sagar"
NOTES="Test meeting created via bash script"
DURATION=15  # minutes
START_TIME="2024-01-15T10:00:00-08:00"  # ISO format with timezone

# Calculate end time
END_TIME=$(date -d "$START_TIME + $DURATION minutes" -u +"%Y-%m-%dT%H:%M:%S.000Z")
START_TIME_UTC=$(date -d "$START_TIME" -u +"%Y-%m-%dT%H:%M:%S.000Z")

echo "Creating calendar invite..."
echo "Email: $EMAIL"
echo "Title: $TITLE"
echo "Start: $START_TIME_UTC"
echo "End: $END_TIME"
echo "Duration: $DURATION minutes"

# Create the calendar event with Gmail invite
curl -X POST "https://www.googleapis.com/calendar/v3/calendars/$CALENDAR_ID/events" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "'"$TITLE"'",
    "description": "'"$NOTES"'",
    "start": {
      "dateTime": "'"$START_TIME_UTC"'",
      "timeZone": "America/Los_Angeles"
    },
    "end": {
      "dateTime": "'"$END_TIME"'",
      "timeZone": "America/Los_Angeles"
    },
    "attendees": [
      {
        "email": "'"$EMAIL"'"
      }
    ],
    "conferenceData": {
      "createRequest": {
        "requestId": "'"$(uuidgen)"'",
        "conferenceSolutionKey": {
          "type": "hangoutsMeet"
        }
      }
    },
    "sendUpdates": "all"
  }' | jq '.'

echo ""
echo "Calendar invite created! Check the response above for event details."
echo "The attendee should receive a Gmail invitation."
