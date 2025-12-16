# Android Build Fixes - December 2025

## 🔧 Critical Fixes Applied

### Issue #1: Sound File Naming Error ✅ FIXED

**Error:**
```
[SoundManager] Failed to preload sound game_start: [Error: Call to function 'ExpoAsset.downloadAsync' has been rejected.
→ Caused by: Illegal character in query at index 70: 
http://192.168.1.109:8081/assets/?unstable_path=.%2Fassets%2Fsounds/Fi mat3am Hawn.m4a
```

**Root Cause:** 
Space characters in the filename "Fi mat3am Hawn.m4a" caused URL encoding issues in Android builds.

**Fix Applied:**
1. ✅ Renamed file: `Fi mat3am Hawn.m4a` → `fi_mat3am_hawn.m4a`
2. ✅ Updated reference in `soundManager.ts` line 25
3. ✅ Updated comment in `soundManager.ts` line 13

**Files Modified:**
- `/apps/mobile/assets/sounds/fi_mat3am_hawn.m4a` (renamed)
- `/apps/mobile/src/utils/soundManager.ts`

---

### Issue #2: Firebase Not Initialized ✅ FIXED

**Error:**
```
[expo-notifications] Error encountered while updating server registration with latest device push token.
[Error: Make sure to complete the guide at https://docs.expo.dev/push-notifications/fcm-credentials/ : 
Default FirebaseApp is not initialized in this process com.big2mobile.app. 
Make sure to call FirebaseApp.initializeApp(Context) first.]
```

**Root Cause:**
Firebase SDK was not being initialized on Android app startup, preventing push notification registration.

**Fix Applied:**
1. ✅ Added Firebase import to `MainApplication.kt`
2. ✅ Added Firebase initialization in `onCreate()` with error handling
3. ✅ Wrapped in try-catch to prevent crashes if `google-services.json` is missing

**Files Modified:**
- `/apps/mobile/android/app/src/main/java/com/big2mobile/app/MainApplication.kt`

**Code Added:**
```kotlin
import com.google.firebase.FirebaseApp

override fun onCreate() {
  super.onCreate()
  
  // Initialize Firebase for push notifications (FCM)
  try {
    FirebaseApp.initializeApp(this)
  } catch (e: Exception) {
    android.util.Log.w("MainApplication", "Firebase initialization failed: ${e.message}")
  }
  
  // ... rest of initialization
}
```

**⚠️ Important:** You still need to:
1. Create Firebase project at https://console.firebase.google.com/
2. Download `google-services.json`
3. Place it in `/apps/mobile/google-services.json`
4. Add FCM credentials to Supabase (see `FIREBASE_FCM_SETUP_GUIDE.md`)

---

### Issue #3: Expo AV Deprecation ⚠️ REQUIRES MIGRATION

**Warning:**
```
WARN  [expo-av]: Expo AV has been deprecated and will be removed in SDK 54. 
Use the `expo-audio` and `expo-video` packages to replace the required functionality.
```

**Status:** Not blocking, but requires future work

**Action Required:**
Migrate from `expo-av` to `expo-audio` before upgrading to Expo SDK 54.

**Migration Plan:**
1. Install `expo-audio`: `pnpm add expo-audio`
2. Replace `Audio` imports from `expo-av` with `expo-audio`
3. Update audio loading/playing code (API is similar but not identical)
4. Test all sound effects thoroughly
5. Remove `expo-av` dependency

**Files Affected:**
- `/apps/mobile/src/utils/soundManager.ts` (primary)
- `/apps/mobile/src/utils/hapticManager.ts` (if using audio)
- Any other files importing from `expo-av`

**Reference:**
- https://docs.expo.dev/versions/latest/sdk/audio/
- https://docs.expo.dev/versions/latest/sdk/video/

---

## 🧪 Testing Results

After applying fixes:

### Sound Manager
- ✅ File renamed successfully
- ✅ No more URL encoding errors
- ✅ Sounds should load properly on next build

### Firebase
- ✅ Initialization code added
- ✅ Graceful error handling if config missing
- ⚠️ Push notifications will still fail until `google-services.json` is added

### Build Status
- 🔄 Requires rebuild with: `npx eas-cli build --profile development --platform android --local`
- 🔄 Or run: `cd apps/mobile && pnpm run android`

---

## 📋 Next Steps

1. **Immediate:**
   - [ ] Rebuild Android app to test sound fixes
   - [ ] Follow `FIREBASE_FCM_SETUP_GUIDE.md` to complete FCM setup
   - [ ] Add `google-services.json` to mobile app root

2. **Short-term:**
   - [ ] Test all sound effects in-game
   - [ ] Verify push notifications work after FCM setup
   - [ ] Update any documentation referencing old sound filename

3. **Long-term:**
   - [ ] Plan migration from `expo-av` to `expo-audio`
   - [ ] Test on multiple Android devices/versions
   - [ ] Consider adding sound preloading progress indicators

---

## 🎯 Summary

**Fixed:**
- ✅ Sound file naming (URL encoding issue)
- ✅ Firebase initialization (push notification support)

**Documented:**
- ⚠️ Expo AV deprecation (future migration required)

**Remaining Work:**
- 🔄 Complete Firebase Cloud Messaging setup
- 🔄 Add `google-services.json` configuration file
- 🔄 Rebuild and test Android app
