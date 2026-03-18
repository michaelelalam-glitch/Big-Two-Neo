# 🔥 Firebase Credentials Setup (SECURITY CRITICAL)

## ⚠️ SECURITY INCIDENT (Dec 2024)

**CRITICAL:** The `google-services.json` file was **accidentally committed** with real Firebase API credentials.

### 🚨 Compromised Credentials
- **API Key:** `[REDACTED — rotated Dec 2024]` (was leaked, now rotated)
- **Project Number:** `809777985378`
- **Project ID:** `twobig-f9a63`

### ✅ Remediation Steps Taken
1. ✅ Removed `google-services.json` from Git tracking
2. ✅ Re-enabled `.gitignore` entry
3. ✅ Created `google-services.json.example` template

### 🔐 ACTION REQUIRED (High Priority)
**You MUST rotate these credentials immediately:**

1. **Go to Firebase Console:** https://console.firebase.google.com/project/twobig-f9a63/settings/general
2. **Restrict the leaked API key:**
   - Navigate to Google Cloud Console > APIs & Services > Credentials
   - Find and delete the previously leaked key (see commit history for reference)
   - **Delete** or restrict to specific app signatures/IP ranges
3. **Generate new API key:**
   - Create a new Android API key
   - Restrict to your app's SHA-1 fingerprint
4. **Download fresh `google-services.json`:**
   - Firebase Console > Project Settings > General
   - Under "Your apps" > Android app > Download `google-services.json`
5. **Place in `apps/mobile/` (NOT committed to Git)**

---

## 📋 Setup Instructions (For New Developers)

### Prerequisites
- Firebase project created: `twobig-f9a63`
- Android app registered in Firebase Console
- Package name: `com.twobiggame.twobig`

### Steps
1. **Download credentials:**
   ```bash
   # Go to Firebase Console and download google-services.json
   # https://console.firebase.google.com/project/twobig-f9a63/settings/general
   ```

2. **Place file in correct location:**
   ```bash
   # Copy downloaded file to:
   apps/mobile/google-services.json
   ```

3. **Verify `.gitignore` protection:**
   ```bash
   # Ensure this line exists in apps/mobile/.gitignore:
   google-services.json
   
   # Verify file is NOT tracked:
   cd apps/mobile
   git status  # should NOT show google-services.json
   ```

4. **Build the app:**
   ```bash
   cd apps/mobile
   eas build --platform android --profile development
   ```

### 🔍 Security Checklist
- [ ] `google-services.json` exists locally
- [ ] `google-services.json` is in `.gitignore`
- [ ] `git status` does NOT show `google-services.json`
- [ ] API key is restricted in Google Cloud Console
- [ ] Old leaked API key is deleted or restricted

---

## 🛡️ Prevention Guidelines

**NEVER commit these files:**
- ❌ `google-services.json` (Android Firebase config)
- ❌ `GoogleService-Info.plist` (iOS Firebase config)
- ❌ `.env` files with API keys
- ❌ `eas.json` with sensitive credentials

**ALWAYS:**
- ✅ Use `.gitignore` to exclude credential files
- ✅ Use example/template files (e.g., `google-services.json.example`)
- ✅ Restrict API keys in Google Cloud Console
- ✅ Rotate credentials immediately if accidentally committed

---

## 📚 References
- [Firebase Android Setup](https://firebase.google.com/docs/android/setup)
- [API Key Restrictions](https://cloud.google.com/docs/authentication/api-keys#securing_an_api_key)
- [Expo EAS Build with Firebase](https://docs.expo.dev/eas/build/configuration/)
