# URGENT: 3 Critical Issues - Action Required

**Date:** December 16, 2025  
**Status:** ⚠️ IMMEDIATE ATTENTION NEEDED

---

## Issue 1: ✅ FIXED - Audio Files Replaced with Unique Sounds

**Problem:** All 6 sound files were duplicates  
**Solution:** Replaced with unique macOS system sounds using `afconvert`

### New Audio Files (UNIQUE):
| File | Size | Source | Sound Characteristic |
|------|------|--------|---------------------|
| `card_play.m4a` | 4.7K | Tink.aiff | Light, crisp click |
| `pass.m4a` | 10K | Submarine.aiff | Deep whoosh/sonar ping |
| `win.m4a` | 15K | Glass.aiff | Bright, celebratory chime |
| `lose.m4a` | 5.3K | Basso.aiff | Low, somber tone |
| `turn_notification.m4a` | 11K | Ping.aiff | Pleasant notification bell |
| `invalid_move.m4a` | 9.7K | Funk.aiff | Error buzz/rejection sound |

**Test:** Play a game and verify each sound is DIFFERENT.

---

## Issue 2: 🚨 CRITICAL - Firebase Configuration (Notifications Broken)

**Problem:** You have a PLACEHOLDER `google-services.json` file  
**Impact:** Push notifications WILL NOT WORK  
**Root Cause:** You told me to delete/gitignore the file, but it still needs to exist LOCALLY

### IMMEDIATE ACTION REQUIRED:

1. **Download REAL file from Firebase Console:**
   ```bash
   # Go to: https://console.firebase.google.com/
   # Project: big2-969bc
   # Settings → General → Your apps → Android app
   # Click "Download google-services.json"
   ```

2. **Replace placeholder:**
   ```bash
   cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/apps/mobile
   # Drag downloaded file here, overwrite google-services.json
   ```

3. **Verify real file:**
   ```bash
   cat google-services.json | grep "PLACEHOLDER"
   # Should return NOTHING if file is real
   ```

4. **Rebuild app:**
   ```bash
   cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/apps/mobile
   eas build --profile development --platform android
   # OR for quick test:
   pnpm run android
   ```

### Current State (PLACEHOLDER):
```json
{
  "project_info": {
    "project_number": "PLACEHOLDER",  ← NOT REAL
    "project_id": "big2-969bc",
    "storage_bucket": "big2-969bc.appspot.com"
  },
  "client": [{
    "client_info": {
      "mobilesdk_app_id": "PLACEHOLDER",  ← NOT REAL
      ...
    },
    "api_key": [{
      "current_key": "PLACEHOLDER_API_KEY"  ← NOT REAL
    }]
  }]
}
```

### What Real File Should Look Like:
```json
{
  "project_info": {
    "project_number": "123456789012",  ← REAL NUMBER
    "project_id": "big2-969bc",
    ...
  },
  "client": [{
    "client_info": {
      "mobilesdk_app_id": "1:123456789012:android:abcdef123456",  ← REAL ID
      ...
    },
    "api_key": [{
      "current_key": "AIzaSyA..."  ← REAL 39-char API KEY
    }]
  }]
}
```

**Why This Matters:**
- ✅ File exists → No crash
- ❌ File has placeholders → No push notifications
- ✅ File has real values → Push notifications work

---

## Issue 3: ⚠️ INVESTIGATING - Vibration Not Triggering at 5 Seconds

**Problem:** Vibration not firing when timer shows "5 sec"  
**Current Code:** `GameScreen.tsx` lines 590-600

```typescript
// 5-second urgency warning vibration
const remaining_ms = gameState.auto_pass_timer.remaining_ms;
const displaySeconds = Math.ceil(remaining_ms / 1000);
if (displaySeconds === 5 && !hasVibrated5SecondWarningRef.current) {
  hapticManager.trigger(HapticType.HEAVY);
  gameLogger.info('📳 [Haptic] 5-second urgency vibration triggered');
  hasVibrated5SecondWarningRef.current = true;
}
```

**Logic:** Mathematically correct - should trigger when display shows "5"

### Possible Root Causes:

**A. Timer Update Frequency Issue**
- **Hypothesis:** `auto_pass_timer` updates infrequently (e.g., every 500ms)
- **Example:** Timer jumps from 5500ms → 4500ms, skipping 5000ms exactly
- **Test:** Add logging to see actual remaining_ms values

**B. useEffect Dependency Issue**
- **Hypothesis:** Effect not re-running on every timer update
- **Current:** `[gameState?.auto_pass_timer]` may not trigger on ms changes
- **Test:** Check if effect fires on every tick

**C. Ref Reset Issue**
- **Hypothesis:** `hasVibrated5SecondWarningRef` not resetting between timers
- **Current:** Should reset when timer becomes null
- **Test:** Log ref value on each update

### Debug Steps:

1. **Add extensive logging:**
   ```typescript
   useEffect(() => {
     console.log('[DEBUG] Timer effect fired:', {
       hasTimer: !!gameState?.auto_pass_timer,
       remaining_ms: gameState?.auto_pass_timer?.remaining_ms,
       displaySeconds: gameState?.auto_pass_timer ? Math.ceil(gameState.auto_pass_timer.remaining_ms / 1000) : null,
       hasVibrated: hasVibrated5SecondWarningRef.current
     });
     
     if (!gameState?.auto_pass_timer) {
       console.log('[DEBUG] Resetting vibration ref');
       hasVibrated5SecondWarningRef.current = false;
       return;
     }
     
     const remaining_ms = gameState.auto_pass_timer.remaining_ms;
     const displaySeconds = Math.ceil(remaining_ms / 1000);
     
     console.log('[DEBUG] Checking vibration trigger:', {
       displaySeconds,
       shouldVibrate: displaySeconds === 5,
       hasVibrated: hasVibrated5SecondWarningRef.current
     });
     
     if (displaySeconds === 5 && !hasVibrated5SecondWarningRef.current) {
       console.log('[DEBUG] TRIGGERING VIBRATION NOW!');
       hapticManager.trigger(HapticType.HEAVY);
       hasVibrated5SecondWarningRef.current = true;
     }
   }, [gameState?.auto_pass_timer]);
   ```

2. **Test with highest card:**
   - Play highest card
   - Watch console logs
   - Record exact remaining_ms values from 6000ms → 4000ms
   - Check if effect fires on every tick

3. **Verify timer subscription:**
   - Check if timer updates every 100ms or 500ms
   - If updates are too slow, may skip 5000ms

### Potential Fixes:

**Option A: Widen trigger window**
```typescript
// Trigger if displaySeconds === 5 OR if we just passed 5
if (displaySeconds === 5 || (displaySeconds === 4 && !hasVibrated5SecondWarningRef.current && remaining_ms > 4900)) {
  hapticManager.trigger(HapticType.HEAVY);
  hasVibrated5SecondWarningRef.current = true;
}
```

**Option B: Use range check**
```typescript
// Trigger once when entering 5-second window
if (remaining_ms <= 5000 && remaining_ms > 4000 && !hasVibrated5SecondWarningRef.current) {
  hapticManager.trigger(HapticType.HEAVY);
  hasVibrated5SecondWarningRef.current = true;
}
```

**Option C: Fix timer update frequency (if root cause)**
- Increase timer tick rate to 100ms
- Ensures we never skip 5000ms

---

## Priority Action Items:

### HIGH (Do Now):
1. ✅ **Audio files** - Already fixed with unique sounds
2. 🚨 **Firebase config** - Download real google-services.json from console
3. 🔍 **Vibration** - Add debug logging, test with highest card

### MEDIUM (After High):
4. Rebuild app after Firebase fix
5. Test all 6 sound effects in game
6. Verify push notifications work

### LOW (Optional):
7. Replace system sounds with custom game sounds (if desired)
8. Fine-tune vibration timing (if debug reveals issue)

---

## Testing Protocol:

### Test 1: Audio (READY NOW)
```
1. Play highest card → hear Tink sound
2. Play any cards → hear Tink sound
3. Pass turn → hear Submarine whoosh
4. Invalid play → hear Funk buzz
5. Win match → hear Glass chime
6. Lose match → hear Basso tone
7. Your turn → hear Ping notification
```

### Test 2: Firebase (After Download)
```
1. Download real google-services.json
2. Overwrite placeholder file
3. Rebuild: eas build --profile development --platform android
4. Install new build
5. Background app
6. Trigger notification
7. Should receive push notification
```

### Test 3: Vibration (Debug First)
```
1. Add debug logging (see above)
2. Play highest card
3. Watch console for remaining_ms values
4. Check if effect fires every tick
5. Verify vibration triggers at 5s
6. If not, analyze logs and apply fix
```

---

## Summary:

| Issue | Status | Action Required |
|-------|--------|----------------|
| **Audio** | ✅ FIXED | None - test to verify |
| **Firebase** | 🚨 CRITICAL | Download real file NOW |
| **Vibration** | 🔍 INVESTIGATING | Add debug logs, test |

---

**Next Steps:**
1. Download `google-services.json` from Firebase Console
2. Replace placeholder file
3. Rebuild app
4. Add vibration debug logging
5. Test all 3 systems

**Questions?**
- Firebase download issue? Check you have Firebase project access
- Vibration not logging? Check console.log output
- Sounds not playing? Check expo-av installation

---

**Documentation Created:** December 16, 2025, 10:49 AM  
**Sounds Updated:** All 6 files replaced with unique system sounds  
**Firebase Status:** PLACEHOLDER (needs real file)  
**Vibration Status:** INVESTIGATING (needs debug logs)
