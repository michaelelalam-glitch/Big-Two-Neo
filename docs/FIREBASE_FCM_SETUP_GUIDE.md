# Firebase Cloud Messaging (FCM) Setup Guide

## 🚨 Critical Issue Found

**Error from console log:**
```
Error registering for push notifications: Make sure to complete the guide at 
https://docs.expo.dev/push-notifications/fcm-credentials/ : 
Default FirebaseApp is not initialized in this process com.big2mobile.app. 
Make sure to call FirebaseApp.initializeApp(Context) first.
```

**Root Cause:** Android push notifications require Firebase Cloud Messaging (FCM) credentials, which are currently missing.

**Impact:** Push token registration fails → No tokens saved to database → No push notifications on Android

---

## ✅ Step-by-Step Setup Instructions

### Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"**
3. Enter project name: `Big Two Mobile` (or your preferred name)
4. **Disable** Google Analytics (optional, not needed for push notifications)
5. Click **"Create project"**
6. Wait for project to be created

### Step 2: Add Android App to Firebase

1. In Firebase Console, click **Android icon** to add Android app
2. Fill in the form:
   - **Android package name:** `com.big2mobile.app` (MUST match app.json)
   - **App nickname:** `Big Two Mobile Android` (optional)
   - **Debug signing certificate SHA-1:** Leave empty for now
3. Click **"Register app"**

### Step 3: Download google-services.json

1. Firebase will generate `google-services.json`
2. Click **"Download google-services.json"**
3. Save the file to: `/Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/apps/mobile/google-services.json`
   - This file goes in the **root of the mobile app** (same directory as app.json)

### Step 4: Get FCM Server Key

1. In Firebase Console, go to **Project Settings** (gear icon)
2. Navigate to **Cloud Messaging** tab
3. Under **"Cloud Messaging API (Legacy)"**, find **"Server key"**
4. Copy the server key (starts with `AAAA...`)

### Step 5: Upload FCM Server Key to Expo

Run this command in the mobile app directory:

```bash
cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/apps/mobile
expo push:android:upload --api-key <YOUR_FCM_SERVER_KEY>
```

Replace `<YOUR_FCM_SERVER_KEY>` with the key you copied from Firebase.

**Expected output:**
```
✔ Successfully uploaded FCM server key
```

### Step 6: Update app.json

Add `googleServicesFile` to the Android configuration:

```json
{
  "expo": {
    "android": {
      "package": "com.big2mobile.app",
      "googleServicesFile": "./google-services.json",
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#25292e"
      },
      "edgeToEdgeEnabled": true,
      "predictiveBackGestureEnabled": false
    }
  }
}
```

### Step 7: Rebuild APK

After completing all configuration:

```bash
cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/apps/mobile
eas build --platform android --profile development
```

### Step 8: Test on Device

1. Install the new APK on your Android phone
2. Sign in with Google OAuth
3. Allow notification permissions when prompted
4. Check Supabase `push_tokens` table - token should appear!

---

## 📋 Verification Checklist

- [ ] Firebase project created
- [ ] Android app added to Firebase with package name `com.big2mobile.app`
- [ ] `google-services.json` downloaded and placed in `/apps/mobile/`
- [ ] FCM Server Key uploaded to Expo
- [ ] `app.json` updated with `googleServicesFile` path
- [ ] New APK built with EAS
- [ ] APK installed on physical Android device
- [ ] User signed in and granted notification permissions
- [ ] Push token appears in Supabase `push_tokens` table

---

## 🔍 Expected Results

### Console Logs (Success)
```
LOG  11:02:17 pm | AUTH | INFO : 🔔 [AuthContext] Registering for push notifications...
LOG  11:02:18 pm | NOTIFY | INFO : ✅ Successfully registered for push notifications
LOG  11:02:18 pm | NOTIFY | INFO : Push token: ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]
LOG  11:02:18 pm | NOTIFY | INFO : ✅ Push token saved to database
```

### Supabase push_tokens Table
```sql
SELECT * FROM push_tokens WHERE user_id = '20bd45cb-1d72-4427-be77-b829e76c6688';
```

**Expected row:**
| user_id | push_token | platform | created_at | updated_at |
|---------|------------|----------|------------|------------|
| 20bd45cb-1d72-4427-be77-b829e76c6688 | ExponentPushToken[...] | android | 2025-12-14 23:02:18 | 2025-12-14 23:02:18 |

---

## 🚨 Important Notes

1. **Physical Device Required:** Push notifications don't work on Android emulators
2. **Package Name Match:** Firebase package name MUST match `app.json` (`com.big2mobile.app`)
3. **google-services.json Location:** Must be in `/apps/mobile/` directory (same level as app.json)
4. **Rebuild Required:** After adding Firebase config, you MUST rebuild the APK
5. **FCM API Enabled:** Firebase automatically enables FCM when you add an Android app

---

## 🔗 Official Documentation

- [Expo FCM Credentials Guide](https://docs.expo.dev/push-notifications/fcm-credentials/)
- [Firebase Console](https://console.firebase.google.com/)
- [Expo Push Notifications Overview](https://docs.expo.dev/push-notifications/overview/)

---

## 🆘 Troubleshooting

### "Cloud Messaging API (Legacy) disabled"
- Go to Firebase Console → Cloud Messaging
- Enable "Cloud Messaging API (Legacy)"

### "google-services.json not found"
- Ensure file is in `/apps/mobile/google-services.json`
- Check `app.json` path: `"googleServicesFile": "./google-services.json"`

### "Invalid package name"
- Firebase package name MUST be `com.big2mobile.app`
- Check `app.json` → `android.package`

### Token still not saving after Firebase setup
- Check Supabase RLS policy on `push_tokens` table
- Verify network connectivity
- Check app logs for specific errors

---

**Status:** Firebase FCM setup required before push notifications will work on Android.
