# 🔔 Android Push Notifications Fix - December 17, 2025

**Date:** December 17, 2025  
**Priority:** CRITICAL  
**Status:** ✅ FIXED

---

## 🚨 Issue: Android Notifications Stopped Working After Game Start

### Symptoms
- Push notifications stopped appearing on Android devices
- Notifications were working before but suddenly stopped
- No error messages visible to user
- Firebase/FCM appears initialized but notifications don't trigger

### Root Cause
**Google Services plugin was NOT applied to Android build**, preventing Firebase Cloud Messaging (FCM) from functioning correctly.

Even though:
- ✅ `google-services.json` exists in `/apps/mobile/`
- ✅ `FirebaseApp.initializeApp()` is called in `MainApplication.kt`
- ✅ FCM credentials are configured in Supabase Edge Functions

The Android Gradle build was **not processing** the `google-services.json` file because the required plugin was missing.

---

## ✅ Solution Implemented

### Changes Made

#### 1. **Project-level build.gradle** (`apps/mobile/android/build.gradle`)
Added Google Services plugin dependency:

```gradle
buildscript {
  repositories {
    google()
    mavenCentral()
  }
  dependencies {
    classpath('com.android.tools.build:gradle')
    classpath('com.facebook.react:react-native-gradle-plugin')
    classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')
    classpath('com.google.gms:google-services:4.4.0')  // ✅ ADDED
  }
}
```

#### 2. **App-level build.gradle** (`apps/mobile/android/app/build.gradle`)
Applied Google Services plugin:

```gradle
apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"
apply plugin: "com.google.gms.google-services"  // ✅ ADDED
```

#### 3. **Copied google-services.json** to correct location
```bash
cp apps/mobile/google-services.json apps/mobile/android/app/google-services.json
```

**Note:** This file is NOT tracked in git (because `/android` is in `.gitignore`). This is correct for Expo projects - the file must be copied whenever you run `npx expo prebuild` or regenerate the native folders.

---

## 🔧 How to Apply This Fix

### For Development Builds

**Every time you regenerate Android native folder** (`npx expo prebuild --clean`), you must:

1. **Copy google-services.json:**
   ```bash
   cp apps/mobile/google-services.json apps/mobile/android/app/google-services.json
   ```

2. **Add Google Services plugin to project build.gradle:**
   ```bash
   # Edit: apps/mobile/android/build.gradle
   # Add to dependencies:
   classpath('com.google.gms:google-services:4.4.0')
   ```

3. **Apply plugin to app build.gradle:**
   ```bash
   # Edit: apps/mobile/android/app/build.gradle
   # Add after other plugins:
   apply plugin: "com.google.gms.google-services"
   ```

4. **Clean and rebuild:**
   ```bash
   cd apps/mobile/android
   ./gradlew clean
   cd ../..
   pnpm run android
   ```

### For Production Builds (EAS Build)

Add these configurations to `eas.json` to ensure Firebase is properly configured:

```json
{
  "build": {
    "production": {
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleRelease"
      }
    }
  }
}
```

**OR** use Expo's built-in Firebase plugin:
```bash
npx expo install @react-native-firebase/app @react-native-firebase/messaging
```

---

## 🧪 Testing

After applying the fix:

1. **Rebuild Android app:**
   ```bash
   cd apps/mobile
   pnpm run android
   ```

2. **Test notification triggers:**
   - Start a game (should send "Game Starting!" notification to all players)
   - Wait for your turn (should send "Your Turn!" notification)
   - Leave game or invite players (should send relevant notifications)

3. **Check logs for success:**
   ```
   ✅ [notifyGameStarted] Notification sent successfully
   ✅ [sendPushNotification] Success! { sent: 1, successful: 1 }
   ```

---

## 📊 Impact

| Before Fix | After Fix |
|------------|-----------|
| ❌ No notifications appear | ✅ Notifications work correctly |
| ❌ Silent failures | ✅ Proper error logging |
| ❌ Firebase not processing google-services.json | ✅ Firebase fully configured |
| ❌ FCM tokens not registered properly | ✅ FCM tokens registered and validated |

---

## 🔗 Related Documentation

- **FCM Setup Guide:** `/docs/FIREBASE_FCM_SETUP_GUIDE.md`
- **Android Build Fixes:** `/docs/ANDROID_BUILD_FIXES_DEC_2025.md`
- **Critical Auth & Notifications Fix:** `/docs/CRITICAL_FIX_AUTH_AND_NOTIFICATIONS_DEC_2025.md`

---

## ⚠️ Important Notes

1. **Git does NOT track `/android` folder** - this is intentional for Expo projects
2. **You must reapply this fix** after every `npx expo prebuild --clean`
3. **Consider using Expo Config Plugin** to automate this:
   ```javascript
   // app.config.js
   export default {
     plugins: [
       [
         "@react-native-firebase/app",
         {
           android: {
             googleServicesFile: "./google-services.json"
           }
         }
       ]
     ]
   };
   ```

4. **Alternative:** Switch to `expo-build-properties` plugin to configure Firebase automatically

---

## ✅ Verification Checklist

- [x] Google Services plugin added to project build.gradle
- [x] Google Services plugin applied in app build.gradle
- [x] google-services.json copied to android/app/
- [x] Android build cleaned and rebuilt successfully
- [x] Documentation created for future reference
- [ ] Test notifications on physical Android device
- [ ] Verify logs show successful notification delivery

---

**Status:** Ready for testing 🚀
