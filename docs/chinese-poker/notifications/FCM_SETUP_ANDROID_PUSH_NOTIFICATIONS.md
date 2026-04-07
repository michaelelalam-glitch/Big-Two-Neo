# 🔔 Firebase Cloud Messaging (FCM) Setup for Android Push Notifications

**Date:** December 14, 2025  
**Priority:** CRITICAL  
**Status:** ⚠️ REQUIRED FOR PRODUCTION

---

## 🚨 Current Issue

Your Android app is receiving this error when trying to send push notifications:

```json
{
  "status": "error",
  "message": "Unable to retrieve the FCM server key for the recipient's app.",
  "details": {
    "error": "InvalidCredentials",
    "fault": "developer"
  }
}
```

**Root Cause:** Expo Push Notifications require **Firebase Cloud Messaging (FCM)** credentials for Android apps. Without FCM setup, notifications **cannot be delivered to Android devices**.

---

## 📋 Prerequisites

- ✅ Expo account with EAS configured
- ✅ Android physical device for testing
- ⏳ Firebase/Google Cloud account (free)
- ⏳ ~15 minutes for setup

---

## 🛠️ Step-by-Step Setup

### **Step 1: Create Firebase Project**

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"**
3. Enter project name: **"Big-Two-Neo"** (or your app name)
4. **Disable Google Analytics** (not needed for push notifications)
5. Click **"Create project"**
6. Wait for project creation (~30 seconds)

---

### **Step 2: Register Android App**

1. In Firebase Console, click **⚙️ Project Settings** (gear icon)
2. Scroll to **"Your apps"** section
3. Click **Android icon** to add Android app
4. Fill in details:
   - **Android package name**: Your app bundle identifier
     - Find in `app.json`: Look for `android.package`
     - Example: `com.yourusername.big2mobile`
   - **App nickname**: "Big Two Mobile" (optional)
   - **Debug signing certificate SHA-1**: Leave blank (not needed)
5. Click **"Register app"**

---

### **Step 3: Download google-services.json**

1. After registering, you'll see **"Download google-services.json"**
2. Click **"Download google-services.json"** button
3. **Save the file** to your project root:
   ```
   apps/mobile/google-services.json
   ```
4. Click **"Next"** → **"Next"** → **"Continue to console"**

---

### **Step 4: Get FCM Server Key**

1. In Firebase Console, go to **⚙️ Project Settings**
2. Click **"Cloud Messaging"** tab
3. Scroll to **"Cloud Messaging API (Legacy)"**
4. **⚠️ IMPORTANT:** If it says "Disabled", click **"Enable"**
   - This enables the Legacy FCM API required by Expo
5. Copy the **"Server key"** (starts with `AAAA...`)
   - **Keep this secret!** Do not commit to Git

---

### **Step 5: Upload FCM Key to Expo**

#### **Option A: Using EAS CLI (Recommended)**

```bash
cd apps/mobile

# Install EAS CLI if not already installed
npm install -g eas-cli

# Login to Expo
eas login

# Upload FCM credentials
eas credentials
# Select: Android → Build Credentials → Push Notifications → Upload FCM Server Key
# Paste your FCM Server Key when prompted
```

#### **Option B: Using Expo Dashboard (Web)**

1. Go to [Expo Dashboard](https://expo.dev/)
2. Navigate to your project
3. Click **"Credentials"** in left sidebar
4. Select **Android**
5. Under **"FCM Server Key"**, click **"Add a FCM Server Key"**
6. Paste your Server Key
7. Click **"Save"**

---

### **Step 6: Add google-services.json to .gitignore**

**⚠️ CRITICAL:** Never commit Firebase credentials to Git!

```bash
# Add to .gitignore
echo "google-services.json" >> apps/mobile/.gitignore
```

---

### **Step 7: Rebuild Your App**

FCM credentials are embedded during build, so you **must rebuild**:

#### **Development Build (For Testing)**

```bash
cd apps/mobile

# Build development APK
eas build --profile development --platform android

# After build completes, install on device:
# Download APK from Expo dashboard and install
```

#### **Production Build (For Release)**

```bash
cd apps/mobile

# Build production APK/AAB
eas build --profile production --platform android
```

---

### **Step 8: Test Push Notifications**

1. **Install the rebuilt app** on your Android device
2. **Sign in** to the app
3. **Start a game** (or trigger any notification event)
4. **Check console logs** for success:

**Expected Success Logs:**
```
📤 [sendPushNotification] Invoking Edge Function with payload: { ... }
✅ [sendPushNotification] Success! { sent: 1, successful: 1 }
✅ [notifyGameStarted] Notification sent successfully
```

**Expected Notification:**
- 🔔 Push notification appears on device
- Title: "🎮 Game Starting!"
- Body: "Your game in room XXXXX is beginning. Good luck!"
- Tapping opens the game

---

## 🔧 Troubleshooting

### **Issue: "Cloud Messaging API is disabled"**

**Solution:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your Firebase project
3. Go to **APIs & Services** → **Library**
4. Search for **"Firebase Cloud Messaging API"**
5. Click **"Enable"**

---

### **Issue: "InvalidCredentials" persists after setup**

**Checklist:**
- ✅ FCM Server Key uploaded to Expo?
- ✅ App rebuilt after uploading credentials?
- ✅ Using the rebuilt APK (not old version)?
- ✅ Correct project selected in Expo dashboard?

**Debug Steps:**
```bash
# Verify credentials are uploaded
eas credentials

# Check which build you're running
adb shell pm list packages | grep your.package.name
adb shell dumpsys package your.package.name | grep versionName
```

---

### **Issue: "google-services.json not found"**

**Solution:**
```bash
# Verify file location
ls -la apps/mobile/google-services.json

# If missing, re-download from Firebase Console
# Project Settings → General → Your apps → google-services.json
```

---

### **Issue: Notifications work in dev but not production**

**Cause:** Different FCM configurations for dev vs production builds.

**Solution:**
1. Upload **same FCM Server Key** for both profiles in EAS
2. Ensure `google-services.json` is in project root for all builds

---

## 📱 iOS Push Notifications (Separate Setup)

iOS uses **Apple Push Notification service (APNs)**, not FCM. This requires:
1. Apple Developer account ($99/year)
2. Push notification certificate/key
3. Separate EAS credentials upload

**iOS Setup Guide:** [Expo APNs Documentation](https://docs.expo.dev/push-notifications/push-notifications-setup/#ios)

---

## 🔐 Security Best Practices

### **DO:**
✅ Keep FCM Server Key in Expo/EAS (never in code)  
✅ Add `google-services.json` to `.gitignore`  
✅ Use environment-specific credentials (dev vs prod)  
✅ Rotate keys if exposed  

### **DON'T:**
❌ Commit FCM Server Key to Git  
❌ Share Server Key publicly  
❌ Hardcode credentials in code  
❌ Use same key across multiple apps  

---

## 📊 Expected Timeline

| Task | Duration |
|------|----------|
| Create Firebase project | 2 minutes |
| Register Android app | 3 minutes |
| Get FCM Server Key | 2 minutes |
| Upload to Expo | 2 minutes |
| Rebuild app | 10-15 minutes |
| Test notifications | 5 minutes |
| **Total** | **~25 minutes** |

---

## 🎯 Verification Checklist

Before considering setup complete:

- [ ] Firebase project created
- [ ] Android app registered in Firebase
- [ ] `google-services.json` downloaded and placed in `apps/mobile/`
- [ ] FCM Server Key copied
- [ ] FCM Server Key uploaded to Expo/EAS
- [ ] `google-services.json` added to `.gitignore`
- [ ] App rebuilt with `eas build`
- [ ] New build installed on Android device
- [ ] Test notification sent successfully
- [ ] Notification appears on device
- [ ] Console logs show "✅ Notification sent successfully"
- [ ] No "InvalidCredentials" errors in logs

---

## 📚 Additional Resources

- **Expo Push Notifications:** https://docs.expo.dev/push-notifications/overview/
- **FCM Setup Guide:** https://docs.expo.dev/push-notifications/fcm-credentials/
- **Firebase Console:** https://console.firebase.google.com/
- **Google Cloud Console:** https://console.cloud.google.com/
- **EAS Build Docs:** https://docs.expo.dev/build/introduction/

---

## 🆘 Still Having Issues?

1. **Check Expo Dashboard:** Look for build/credentials errors
2. **Review Firebase Console:** Ensure APIs are enabled
3. **Verify App Package Name:** Must match exactly in Firebase and `app.json`
4. **Test on Multiple Devices:** Rule out device-specific issues
5. **Check Expo Status:** https://status.expo.dev/

---

**⚠️ CRITICAL NOTE:** Without FCM setup, **Android push notifications will NOT work**. This is a mandatory step for production apps.

**📅 Recommended Action:** Set up FCM **before next testing session** to ensure full notification functionality.
