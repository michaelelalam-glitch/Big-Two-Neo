#!/bin/bash
set -e

echo "✅ Running expo prebuild..."
npx expo prebuild --no-install --platform android

echo "✅ Copying google-services.json to android/app..."
mkdir -p android/app
cp google-services.json android/app/google-services.json

echo "✅ Prebuild complete with Firebase config"
