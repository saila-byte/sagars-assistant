#!/bin/bash

echo "Downloading background image..."
curl -L -o public/background.svg "https://cdn.prod.website-files.com/68a3622d17312a5dc16e5cc6/68c2a09e4c1562667849c15e_hero-bg%20v2.svg"

if [ -f "public/background.svg" ] && [ -s "public/background.svg" ]; then
    echo "✅ Background image downloaded successfully!"
    echo "File size: $(ls -lh public/background.svg | awk '{print $5}')"
else
    echo "❌ Failed to download background image"
    echo "Please manually download the image from:"
    echo "https://cdn.prod.website-files.com/68a3622d17312a5dc16e5cc6/68c2a09e4c1562667849c15e_hero-bg%20v2.svg"
    echo "And save it as: public/background.svg"
fi
