#!/bin/bash

# Landscape Game Room - Quick Start Testing Script
# Run this to start testing the landscape layout
# Date: December 18, 2025

echo "🎮 Big2 Mobile - Landscape Game Room Testing"
echo "=============================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Not in mobile app directory"
    echo "   Please cd to apps/mobile first"
    exit 1
fi

echo "✅ Directory check passed"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
else
    echo "✅ Dependencies already installed"
fi

echo ""
echo "🧪 Running unit tests..."
echo "------------------------"
npm test -- --testPathPattern="Landscape" --silent 2>&1 | grep -E "(Test Suites|Tests:|Time:)" || echo "Tests running..."

echo ""
echo "🚀 Starting development server..."
echo "--------------------------------"
echo ""
echo "📱 How to test:"
echo "   1. Wait for QR code to appear"
echo "   2. Open Expo Go app on your device"
echo "   3. Scan the QR code"
echo "   4. Create or join a game room"
echo "   5. Tap the orientation toggle button (🔄)"
echo "   6. Verify landscape layout appears"
echo ""
echo "📋 Testing checklist at:"
echo "   docs/LANDSCAPE_GAME_ROOM_TESTING_GUIDE.md"
echo ""
echo "Press Ctrl+C to stop the server when done testing"
echo ""

# Start the dev server
npm start
