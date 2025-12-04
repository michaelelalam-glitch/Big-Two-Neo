# Task #260: Quick Start Checklist

✅ **IMPLEMENTATION COMPLETE** - Follow this checklist to get authentication working!

---

## 🚀 Current Status

**What's Done:**
- ✅ All code implemented
- ✅ Development server running
- ✅ Zero compilation errors
- ✅ App ready for configuration

**What's Needed:**
- ⏳ OAuth provider configuration
- ⏳ Physical device testing

---

## 📋 QUICK START CHECKLIST

### Phase 1: Supabase Setup (15 minutes)

#### 1.1 Get Supabase Credentials
```bash
# Go to: https://supabase.com/dashboard
# Select project: big2-mobile-backend (dppybucldqufbqhwnkxu)
# Go to: Settings → API
# Copy:
#   - Project URL
#   - anon/public key
```

#### 1.2 Update .env File
```bash
cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/mobile

# Edit .env and update:
EXPO_PUBLIC_SUPABASE_URL=https://dppybucldqufbqhwnkxu.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_actual_anon_key_here
```

#### 1.3 Create Profiles Table
```sql
-- Go to: Supabase Dashboard → SQL Editor
-- Run this SQL:

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  updated_at timestamp with time zone,
  username text unique,
  full_name text,
  avatar_url text,
  constraint username_length check (char_length(username) >= 3)
);

alter table public.profiles enable row level security;

create policy "Public profiles are viewable by everyone"
  on profiles for select using (true);

create policy "Users can insert their own profile"
  on profiles for insert with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'full_name', 
          new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

**Status:** ☐ Profiles table created

---

### Phase 2: Apple Sign-In Setup (30 minutes)

#### 2.1 Apple Developer Portal
```
1. Go to: https://developer.apple.com/
2. Navigate to: Certificates, Identifiers & Profiles
3. Create App ID:
   - Identifiers → App IDs → +
   - Description: Big2 Mobile
   - Bundle ID: com.big2mobile.app
   - Enable: Sign In with Apple
   - Register

4. Create Service ID:
   - Identifiers → Services IDs → +
   - Description: Big2 Mobile Auth
   - Identifier: com.big2mobile.app.auth
   - Enable: Sign In with Apple
   - Configure:
     - Domains: dppybucldqufbqhwnkxu.supabase.co
     - Return URLs: https://dppybucldqufbqhwnkxu.supabase.co/auth/v1/callback
   - Save & Register
```

#### 2.2 Supabase Dashboard
```
1. Go to: Authentication → Providers
2. Enable Apple provider
3. Enter:
   - Service ID: com.big2mobile.app.auth
   - Secret Key: (generate if needed)
4. Save
```

#### 2.3 Update .env
```bash
# Uncomment and update in .env:
EXPO_PUBLIC_APPLE_AUTH_SERVICE_ID=com.big2mobile.app.auth
EXPO_PUBLIC_APPLE_AUTH_REDIRECT_URI=big2mobile://apple-auth
```

**Status:** ☐ Apple OAuth configured

---

### Phase 3: Google Sign-In Setup (30 minutes)

#### 3.1 Google Cloud Console
```
1. Go to: https://console.cloud.google.com/
2. Create/Select Project: Big2 Mobile
3. Enable APIs:
   - APIs & Services → Library
   - Search: Google+ API
   - Enable

4. Create OAuth Credentials:
   - APIs & Services → Credentials
   - Create Credentials → OAuth 2.0 Client ID
   - Application type: Web application
   - Name: Big2 Mobile Web
   - Authorized redirect URIs:
     - https://dppybucldqufbqhwnkxu.supabase.co/auth/v1/callback
   - Create
   - Copy Client ID (save this!)
```

#### 3.2 Supabase Dashboard
```
1. Go to: Authentication → Providers
2. Enable Google provider
3. Enter:
   - Client ID: (from Google Cloud)
   - Client Secret: (from Google Cloud)
4. Save
```

#### 3.3 Update .env
```bash
# Uncomment and update in .env:
EXPO_PUBLIC_GOOGLE_AUTH_WEB_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

**Status:** ☐ Google OAuth configured

---

### Phase 4: Test on Simulator (5 minutes)

```bash
cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/mobile

# iOS Simulator
npm run ios

# Android Emulator
npm run android
```

**Expected Results:**
- ✅ App opens to SignIn screen
- ✅ Apple button shows (iOS only)
- ✅ Google button shows
- ⚠️ Apple Sign-In may show credential error (normal on simulator)
- ✅ UI looks correct

**Status:** ☐ Simulator testing complete

---

### Phase 5: Test on Physical Device (15 minutes)

#### 5.1 iOS Device Testing

**Option A: Via Cable**
```bash
# Connect iPhone via USB
npm run ios
# Select your device in Xcode
```

**Option B: Via Expo Go**
```bash
npm start
# Scan QR code with Camera app
# Opens in Expo Go
```

**Test Checklist:**
- ☐ Tap "Sign in with Apple"
- ☐ Complete Apple authentication
- ☐ App redirects to Home screen
- ☐ Profile button shows in header
- ☐ Tap Profile → See user data
- ☐ Tap Sign Out → Returns to SignIn
- ☐ Close and reopen app → Still logged in
- ☐ Test session persists after 5 minutes

#### 5.2 Android Device Testing

**Option A: Via Cable**
```bash
# Enable USB debugging on device
# Connect via USB
npm run android
```

**Option B: Via Expo Go**
```bash
npm start
# Scan QR code with Expo Go app
```

**Test Checklist:**
- ☐ Tap "Sign in with Google"
- ☐ Browser opens with Google OAuth
- ☐ Complete Google authentication
- ☐ App redirects to Home screen
- ☐ Profile button shows in header
- ☐ Tap Profile → See user data
- ☐ Tap Sign Out → Returns to SignIn
- ☐ Close and reopen app → Still logged in
- ☐ Test session persists after 5 minutes

---

## 🎯 Success Criteria

### All Complete = Ready for Production! ✅

```
Configuration:
  ☐ Supabase credentials in .env
  ☐ Profiles table created in database
  ☐ Apple OAuth provider enabled
  ☐ Google OAuth provider enabled
  ☐ Apple Service ID configured
  ☐ Google Client ID configured

Testing:
  ☐ Simulator testing passed
  ☐ iOS device: Apple Sign-In works
  ☐ Android device: Google Sign-In works
  ☐ Session persists after app restart
  ☐ Sign-out works correctly
  ☐ Profile data displays correctly
  ☐ No errors in console

Production Readiness:
  ☐ All tests passed
  ☐ Zero runtime errors
  ☐ OAuth flows smooth
  ☐ UX is polished
```

---

## 🐛 Troubleshooting Quick Fixes

### Issue: "Invalid OAuth configuration"
**Fix:** Check Supabase Dashboard → Auth → Providers are enabled

### Issue: Apple Sign-In fails on simulator
**Fix:** Normal! Test on real device

### Issue: Google OAuth doesn't redirect back
**Fix:** Check redirect URI in Google Cloud Console matches Supabase

### Issue: Session doesn't persist
**Fix:** Check SecureStore permissions in app.json

### Issue: "Profiles table not found"
**Fix:** Run the SQL from Phase 1.3 in Supabase SQL Editor

---

## 📖 Full Documentation

**For detailed instructions, see:**
- `docs/TASK_260_AUTH_COMPLETE.md` - Complete guide
- `docs/TASK_260_IMPLEMENTATION_SUMMARY.md` - Implementation overview

---

## ✅ READY TO GO!

**Your development server is already running!**

```
Server Status: ✅ RUNNING
Port: 8081
Ready for: Configuration & Testing
```

**Next Step:** Start with Phase 1 (Supabase Setup) above! 🚀

---

**Questions?**
- Check documentation in `docs/` folder
- All code is fully commented
- TypeScript provides inline help

**Good luck! You've got this! 🎉**
