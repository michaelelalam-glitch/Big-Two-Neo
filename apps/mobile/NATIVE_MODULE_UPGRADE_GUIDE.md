# Native Module Upgrade Guide

**Last Updated:** December 11, 2025  
**React Native Version:** 0.82.1  
**Expo SDK:** 54

---

## Understanding the Architecture

### Expo Go vs Development Build

#### ❌ **Expo Go** (Pre-built App)
- **What it is:** A pre-built app from the App Store with hardcoded native modules
- **Limitations:**
  - Cannot use custom native code
  - Locked to specific package versions (e.g., RN 0.81.5, Reanimated 4.1.1, Worklets 0.5.1)
  - Will show version mismatch errors if you upgrade beyond Expo SDK expectations
- **Use case:** Quick prototyping with standard Expo modules only

#### ✅ **Development Build** (Custom Build)
- **What it is:** A custom-compiled app with YOUR exact native module versions
- **Benefits:**
  - Full control over native dependencies
  - Can upgrade to latest package versions
  - Required for: react-native-worklets, react-native-reanimated 4.x, custom native modules
- **Use case:** Production apps, custom native modules, latest package versions

---

## Why This Matters

When you upgrade packages like:
- `react-native` 0.81.5 → 0.82.1
- `react-native-reanimated` 4.1.1 → 4.2.0  
- `react-native-worklets` 0.5.1 → 0.7.1

**Expo Go CANNOT run your app** because it was compiled with the old versions.

**Error you'll see:**
```
WorkletsError: Mismatch between JavaScript part and native part of Worklets (0.7.1 vs 0.5.1)
```

---

## The Production-Grade Solution

### Step 1: Create Development Build

```bash
# Clean regenerate native projects
npm run prebuild

# Build for iOS Simulator
npm run ios

# Build for iOS Device
npm run ios:device

# Build for Android
npm run android
```

### Step 2: After Any Native Dependency Upgrade

```bash
# Use the automated rebuild script
npm run rebuild:native

# Then rebuild the app
npm run ios
```

---

## What Gets Rebuilt

The `prebuild` command:
1. ✅ Deletes old `ios/` and `android/` directories
2. ✅ Regenerates native projects from `package.json` + `app.json`
3. ✅ Runs `pod install` with new CocoaPods versions
4. ✅ Updates all native module bindings

The `run:ios` command:
1. ✅ Compiles native Objective-C/Swift code
2. ✅ Links all native modules (Worklets, Reanimated, etc.)
3. ✅ Bundles JavaScript with Metro
4. ✅ Installs on simulator/device
5. ✅ Launches the app

---

## Common Errors & Solutions

### Error: "Mismatch between JavaScript and native part"
**Cause:** JavaScript updated but native code still cached  
**Fix:** `npm run rebuild:native && npm run ios`

### Error: "Command PhaseScriptExecution failed"
**Cause:** CocoaPods cache corruption  
**Fix:** 
```bash
cd ios
rm -rf Pods Podfile.lock build
pod install --repo-update
cd ..
npm run ios
```

### Error: "The following packages should be updated"
**Cause:** Using versions newer than Expo SDK expects (THIS IS OKAY)  
**Fix:** Ignore if using development build. This warning is for Expo Go users.

---

## Package Version Strategy

### Current Versions (Dec 2025)
```json
{
  "react": "19.1.1",              // Matches RN 0.82.1 renderer
  "react-native": "0.82.1",       // Latest stable
  "react-native-reanimated": "4.2.0",  // New Architecture required
  "react-native-worklets": "0.7.1",    // Breaking: runOnUIAsync signature
  "@supabase/supabase-js": "2.87.1",   // Latest bug fixes
  "react-native-gesture-handler": "2.29.1"  // Latest patch
}
```

### Upgrade Philosophy
1. ✅ **DO upgrade:** Security patches, bug fixes, new features
2. ✅ **DO test:** Run full test suite after upgrades
3. ✅ **DO rebuild:** Always rebuild native after native module updates
4. ❌ **DON'T skip:** Native rebuilds (causes version mismatches)
5. ❌ **DON'T downgrade:** To match Expo Go (defeats the purpose)

---

## CI/CD Integration

### GitHub Actions Example
```yaml
- name: Install dependencies
  run: npm ci

- name: Rebuild native projects
  run: npm run prebuild

- name: Build iOS
  run: npx expo build:ios --non-interactive

- name: Run tests
  run: npm test
```

---

## Future Upgrades

When upgrading any package with native code:

1. **Update package.json**
2. **Run `npm install`**
3. **Check release notes for breaking changes**
4. **Run `npm run rebuild:native`** ← CRITICAL
5. **Build app: `npm run ios`**
6. **Test thoroughly**
7. **Commit both `package.json` AND `package-lock.json`**

### Packages Requiring Native Rebuild
- react-native
- react-native-reanimated
- react-native-worklets
- react-native-gesture-handler
- Any package with `ios/` or `android/` folders
- Expo modules (expo-notifications, expo-camera, etc.)

---

## Debugging Tips

### Check what's actually installed:
```bash
npm list react-native react-native-worklets react-native-reanimated
```

### Check native module versions in iOS:
```bash
cd ios
grep -r "WORKLETS_VERSION" Pods/
grep -r "REANIMATED_VERSION" Pods/
```

### Clear ALL caches:
```bash
rm -rf node_modules/.cache
rm -rf ios/build ios/Pods
rm -rf .expo
npm run rebuild:native
```

---

## Summary

**The Problem:**  
Expo Go uses pre-compiled native modules. When you upgrade packages, JavaScript updates but native code doesn't.

**The Solution:**  
Use development builds (`expo run:ios`) which compile native code with YOUR exact versions.

**The Process:**  
1. Upgrade packages in `package.json`
2. Run `npm run rebuild:native`
3. Build with `npm run ios`
4. Never go back to Expo Go for this project

**The Result:**  
Production-grade app with:
- Latest package versions
- No version mismatch errors
- Full native module support
- Scalable architecture for future growth

---

## Related Documentation

- [Expo Development Builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [React Native Upgrade Helper](https://react-native-community.github.io/upgrade-helper/)
- [Reanimated Installation](https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/installation)
- [Worklets Troubleshooting](https://docs.swmansion.com/react-native-worklets/docs/guides/troubleshooting)
