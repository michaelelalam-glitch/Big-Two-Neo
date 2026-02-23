# app.json Configuration Changes - December 2025

**Date:** December 17, 2025  
**Context:** Phase 4 Polish & Optimizations  
**PR:** #54

---

## Summary

This document explains recent changes to `apps/mobile/app.json` configuration, specifically the removal of Firebase/Google Services configuration fields.

---

## Changes Made

### 1. Removed `googleServicesFile` from Android configuration

**Before:**
```json
"android": {
  "package": "com.big2mobile.app",
  "googleServicesFile": "./google-services.json",
  ...
}
```

**After:**
```json
"android": {
  "package": "com.big2mobile.app",
  ...
}
```

### 2. Removed `@react-native-firebase/app` Gradle plugin

**Before:**
```json
"plugins": [
  "expo-dev-client",
  ["@react-native-firebase/app"],
  ...
]
```

**After:**
```json
"plugins": [
  "expo-dev-client",
  ...
]
```

---

## Rationale

### Why These Changes Were Made

1. **Development Build Compatibility**
   - The `googleServicesFile` configuration was causing **prebuild errors** when building development APKs with Expo Dev Client
   - Error: `google-services.json not found` during `expo prebuild --platform android --clean`
   - Development builds DO NOT require Firebase configuration at build time

2. **Gradle Plugin Conflicts**
   - The `@react-native-firebase/app` Gradle plugin was generating malformed `build.gradle` files
   - Caused syntax errors on line 3 of generated Gradle files
   - Incompatible with Expo's New Architecture (`newArchEnabled: true`)

3. **Runtime vs Build-time Configuration**
   - Firebase initialization happens at **runtime** via `@react-native-firebase/app` JavaScript SDK
   - The `google-services.json` file is only needed for **production builds** and **cloud builds**
   - Development builds use Expo Dev Client and can skip Firebase configuration

---

## Impact Assessment

### ✅ What Still Works

- **Google Sign-In:** Still functional (uses Expo Web Browser OAuth flow, not Firebase Auth)
- **Push Notifications:** Still functional (uses Expo Notifications API)
- **Development Builds:** Now build successfully without errors
- **Hot Reload:** Fully functional with Expo Dev Client

### ⚠️ What Requires google-services.json

- **Production Builds:** EAS production builds still require `google-services.json` in project root
- **Firebase Features:** If using Firebase Realtime Database, Cloud Firestore, or Analytics
- **Cloud Builds:** EAS cloud builds need the file for proper FCM integration

---

## How to Build for Production

When building for production (not development), ensure:

1. **Add google-services.json to project root:**
   ```bash
   # Download from Firebase Console
   # Project Settings → General → Your apps → google-services.json
   cp ~/Downloads/google-services.json apps/mobile/google-services.json
   ```

2. **Temporarily add googleServicesFile to app.json:**
   ```json
   "android": {
     "package": "com.big2mobile.app",
     "googleServicesFile": "./google-services.json",
     ...
   }
   ```

3. **Build production APK/AAB:**
   ```bash
   cd apps/mobile
   eas build --profile production --platform android
   ```

4. **Remove google-services.json after build** (contains sensitive data):
   ```bash
   git checkout apps/mobile/app.json
   rm apps/mobile/google-services.json
   ```

---

## Development Build Workflow (Current)

For **development builds** (iOS simulator, Android APK with hot reload):

1. **No google-services.json needed**
2. **No googleServicesFile in app.json needed**
3. **Build commands:**
   ```bash
   # Android development APK
   cd apps/mobile
   pnpm eas build --profile development --platform android --local

   # iOS simulator
   pnpm expo run:ios --device
   ```

---

## Related Documentation

- `FCM_SETUP_ANDROID_PUSH_NOTIFICATIONS.md` - Firebase setup guide (for production)
- `URGENT_FIREBASE_SETUP_DEC_2025.md` - Firebase troubleshooting
- `BUILD_INSTRUCTIONS.md` - Development build instructions
- `ANDROID_BUILD_FIXES_DEC_2025.md` - Previous Android build issues

---

## Key Takeaway

**Development Builds ≠ Production Builds**

- **Development:** Uses Expo Dev Client, no Firebase config needed at build time
- **Production:** Requires `google-services.json` for FCM and Firebase features

This separation allows faster iteration during development while maintaining full Firebase functionality in production.

---

**Status:** ✅ Configuration optimized for development workflow  
**Next Steps:** Restore googleServicesFile only when building for production
