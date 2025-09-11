#!/bin/bash

echo "Downloading background image..."
curl -L -o public/background.png "https://tavus.slack.com/files/U09BUE35YT1/F09EN0TE73Q/-__1_.png"

if [ -f "public/background.png" ] && [ -s "public/background.png" ]; then
    echo "✅ Background image downloaded successfully!"
    echo "File size: $(ls -lh public/background.png | awk '{print $5}')"
else
    echo "❌ Failed to download background image"
    echo "Please manually download the image from:"
    echo "https://tavus.slack.com/files/U09BUE35YT1/F09EN0TE73Q/-__1_.png"
    echo "And save it as: public/background.png"
fi
