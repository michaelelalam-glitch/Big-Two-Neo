# Build Instructions for Development Builds

**Project:** Big-Two-Neo Mobile App  
**Created:** December 17, 2025  
**Purpose:** Instructions for building Android APK and iOS Simulator app after Phase 4 completion

---

## 📋 Prerequisites

### Required Tools
- **Node.js:** v20.x or higher
- **pnpm:** v10.19.0 or higher
- **Expo CLI:** Bundled with project
- **Android Studio:** For Android builds (with Android SDK)
- **Xcode:** For iOS builds (macOS only, v15+ recommended)

### Verify Installation
```bash
node --version    # Should be v20.x+
pnpm --version    # Should be v10.19.0+
```

---

## 🤖 Android Development Build

### Option 1: Build APK Locally (Recommended)

**Step 1: Connect Android device or start emulator**
```bash
# Check connected devices
adb devices

# Or start Android Studio emulator
# Android Studio > Tools > Device Manager > Play button
```

**Step 2: Build and install development APK**
```bash
cd apps/mobile
pnpm expo run:android --variant debug
```

**Output:** APK will be built and installed automatically on connected device/emulator

**APK Location:**  
`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

**To copy to another device:**
```bash
# Copy APK to desktop
cp apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk ~/Desktop/big2-mobile-dev.apk

# Install on another device via adb
adb install ~/Desktop/big2-mobile-dev.apk
```

---

### Option 2: Build with EAS (Cloud Build)

**Step 1: Install EAS CLI**
```bash
npm install -g eas-cli
```

**Step 2: Login to Expo**
```bash
eas login
```

**Step 3: Build development APK**
```bash
cd apps/mobile
eas build --profile development --platform android
```

**Output:** Download link will be provided after build completes (~10-15 minutes)

**Note:** This requires an Expo account and builds in the cloud.

---

## 🍎 iOS Simulator Build

### Prerequisites
- macOS with Xcode installed
- iOS Simulator installed (comes with Xcode)

### Build Steps

**Step 1: Ensure Xcode Command Line Tools are installed**
```bash
xcode-select --install
```

**Step 2: Build for iOS Simulator**
```bash
cd apps/mobile
pnpm expo run:ios
```

**Step 3: Select simulator when prompted**
- Recommended: iPhone 16 Pro (iOS 18.0)
- Alternative: Any iPhone model with iOS 17.0+

**Output:** App will be built and launched automatically in iOS Simulator

**App Location:**  
`~/Library/Developer/Xcode/DerivedData/[hash]/Build/Products/Debug-iphonesimulator/big2mobile.app`

**To copy simulator build:**
```bash
# Find the most recent build
find ~/Library/Developer/Xcode/DerivedData -name "big2mobile.app" -type d -maxdepth 5

# Copy to desktop (example path, adjust hash)
cp -R ~/Library/Developer/Xcode/DerivedData/big2mobile-[hash]/Build/Products/Debug-iphonesimulator/big2mobile.app ~/Desktop/
```

---

## 📦 Production Builds

### Android Production APK
```bash
cd apps/mobile
eas build --profile production --platform android
```

### iOS Production (TestFlight)
```bash
cd apps/mobile
eas build --profile production --platform ios
```

**Note:** Production builds require:
- Expo account with EAS subscription
- App Store Connect account (iOS)
- Google Play Console account (Android)
- Code signing certificates configured

---

## 🛠️ Troubleshooting

### Android Build Fails

**Error: "No connected device"**
```bash
# Check devices
adb devices

# Restart adb server
adb kill-server && adb start-server

# Check Android Studio emulator is running
```

**Error: "SDK location not found"**
```bash
# Set ANDROID_HOME environment variable
export ANDROID_HOME=~/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools
```

**Error: "Gradle build failed"**
```bash
# Clean gradle cache
cd apps/mobile/android
./gradlew clean

# Rebuild
cd ..
pnpm expo run:android --variant debug
```

---

### iOS Build Fails

**Error: "xcode-select: error: tool 'xcodebuild' requires Xcode"**
```bash
# Install Xcode from App Store, then:
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

**Error: "Could not find simulator"**
```bash
# List available simulators
xcrun simctl list devices

# Boot a specific simulator
xcrun simctl boot "iPhone 16 Pro"
```

**Error: "Code signing required"**
- Open `apps/mobile/ios/big2mobile.xcworkspace` in Xcode
- Select project > Signing & Capabilities
- Select your Apple ID team
- Enable "Automatically manage signing"

---

## 🚀 Quick Start (After Phase 4)

**Android (with connected device/emulator):**
```bash
cd apps/mobile
pnpm expo run:android --variant debug
```

**iOS (with macOS + Xcode):**
```bash
cd apps/mobile
pnpm expo run:ios
```

**Development Server (for both):**
```bash
cd apps/mobile
pnpm start
# Then scan QR code with Expo Go app (development client not required)
```

---

## 📝 Build Variants

### Development
- Includes DevTools, debug menu, hot reload
- Larger file size (~50MB Android, ~80MB iOS)
- Not optimized for performance
- **Purpose:** Testing during development

### Preview
- Similar to production but with internal distribution
- No DevTools, optimized build
- Medium file size (~30MB Android, ~50MB iOS)
- **Purpose:** Beta testing, stakeholder review

### Production
- Fully optimized, minimal bundle size
- No debug symbols
- Smallest file size (~20MB Android, ~40MB iOS)
- **Purpose:** App Store / Play Store release

---

## 🔐 Environment Variables

**Required for builds:**
- `EXPO_PUBLIC_SUPABASE_URL` - Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key
- `EXPO_PUBLIC_GOOGLE_AUTH_WEB_CLIENT_ID` - Google OAuth client ID

**Optional:**
- `EXPO_PUBLIC_STUN_SERVER` - WebRTC STUN server
- `EXPO_PUBLIC_TURN_SERVER` - WebRTC TURN server
- `EXPO_PUBLIC_TURN_USERNAME` - TURN username
- `EXPO_PUBLIC_TURN_CREDENTIAL` - TURN credential

**Load from `.env.local`:**
```bash
# apps/mobile/.env.local (create if not exists)
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
# ... other variables
```

---

## ✅ Post-Build Verification

**Android:**
```bash
# Check APK size
ls -lh apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk

# Install and test
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb logcat | grep -i "ReactNative\|Expo"
```

**iOS:**
```bash
# Launch in specific simulator
xcrun simctl boot "iPhone 16 Pro"
xcrun simctl install booted ~/path/to/big2mobile.app
xcrun simctl launch booted com.big2mobile.app
```

---

**Last Updated:** December 17, 2025  
**Phase 4 Status:** ✅ Complete - All optimizations applied  
**Build Readiness:** ✅ Ready for development builds  
**Production Readiness:** ⚠️ Requires code signing setup
