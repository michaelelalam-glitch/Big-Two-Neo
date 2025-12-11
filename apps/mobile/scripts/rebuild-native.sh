#!/bin/bash
#
# Robust Native Rebuild Script
# 
# Purpose: Cleanly rebuild iOS/Android native code after dependency updates
# Use when: Upgrading React Native, Reanimated, Worklets, or other native modules
#
# This ensures:
# - No cached native modules from old versions
# - Clean CocoaPods installation
# - Proper native code generation from package.json
#

set -e  # Exit on any error

echo "🧹 Cleaning native build artifacts..."
rm -rf ios/build
rm -rf ios/Pods
rm -rf ios/Podfile.lock
rm -rf android/build
rm -rf android/app/build
rm -rf .expo
rm -rf node_modules/.cache

echo "📦 Reinstalling npm dependencies..."
npm ci

echo "🔧 Regenerating native projects..."
npx expo prebuild --clean

echo "✅ Native rebuild complete!"
echo ""
echo "Next steps:"
echo "  - iOS Simulator: npx expo run:ios"
echo "  - iOS Device:    npx expo run:ios --device"
echo "  - Android:       npx expo run:android"
