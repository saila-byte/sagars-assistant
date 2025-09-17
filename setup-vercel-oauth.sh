#!/bin/bash

echo "🔐 Setting up OAuth tokens for Vercel deployment"
echo "=============================================="
echo ""

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Please install it first:"
    echo "npm i -g vercel"
    exit 1
fi

echo "✅ Vercel CLI found"
echo ""

# Check if .google-tokens.json exists
if [ ! -f ".google-tokens.json" ]; then
    echo "❌ .google-tokens.json file not found!"
    echo "Please run the OAuth flow locally first to generate tokens."
    exit 1
fi

echo "✅ .google-tokens.json file found"
echo ""

# Extract tokens from the file
ACCESS_TOKEN=$(cat .google-tokens.json | jq -r '.access_token')
REFRESH_TOKEN=$(cat .google-tokens.json | jq -r '.refresh_token')
EXPIRY_DATE=$(cat .google-tokens.json | jq -r '.expiry_date')
TOKEN_TYPE=$(cat .google-tokens.json | jq -r '.token_type')
SCOPE=$(cat .google-tokens.json | jq -r '.scope')

echo "📋 Extracted tokens:"
echo "  Access Token: ${ACCESS_TOKEN:0:20}..."
echo "  Refresh Token: ${REFRESH_TOKEN:0:20}..."
echo "  Expiry Date: $(date -d @$((EXPIRY_DATE/1000)) 2>/dev/null || echo $EXPIRY_DATE)"
echo "  Token Type: $TOKEN_TYPE"
echo "  Scope: $SCOPE"
echo ""

# Set environment variables on Vercel
echo "🚀 Setting environment variables on Vercel..."
echo ""

vercel env add GOOGLE_ACCESS_TOKEN <<< "$ACCESS_TOKEN"
vercel env add GOOGLE_REFRESH_TOKEN <<< "$REFRESH_TOKEN"
vercel env add GOOGLE_TOKEN_EXPIRY <<< "$EXPIRY_DATE"
vercel env add GOOGLE_TOKEN_TYPE <<< "$TOKEN_TYPE"
vercel env add GOOGLE_TOKEN_SCOPE <<< "$SCOPE"

echo ""
echo "✅ OAuth tokens have been set on Vercel!"
echo ""
echo "🔄 You may need to redeploy your Vercel app for the changes to take effect:"
echo "vercel --prod"
echo ""
echo "🔍 To verify the tokens are set, run:"
echo "vercel env ls"
