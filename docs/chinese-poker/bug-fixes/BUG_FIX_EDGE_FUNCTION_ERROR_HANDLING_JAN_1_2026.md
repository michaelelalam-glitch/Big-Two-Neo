# BUG FIX: Edge Function Error Handling - Detailed Error Messages

**Date identified:** January 1, 2026  
**Date resolved:** January 7, 2026  
**Status:** ✅ COMPLETE (as of January 7, 2026)  
**Priority:** HIGH  
**Affected:** player-pass, play-cards Edge Function calls

---

## 🐛 Problem

User reported seeing generic error message when trying to pass:

```
Error: Edge Function returned a non-2xx status code
```

### Console Log Evidence
```
LOG  4:16:46 pm | GAME | INFO : [useRealtime] 📡 Calling player-pass Edge Function...
LOG  4:16:47 pm | GAME | ERROR : [useRealtime] ❌ Pass failed: Edge Function returned a non-2xx status code
LOG  4:16:47 pm | GAME | ERROR : [GameScreen] Multiplayer error: Edge Function returned a non-2xx status code
```

### Root Cause

When Supabase Edge Functions return a non-2xx HTTP status code (400, 404, 500, etc.), the error object contains:
- `error.message`: Generic wrapper message ("Edge Function returned a non-2xx status code")
- `error.context.status`: Actual HTTP status code (e.g., 400, 404)
- `result.error`: Actual error message from Edge Function response body (e.g., "Not your turn", "Cannot pass when leading")

**The bug:** We were only checking `error.message`, which gave the generic wrapper instead of the actual error.

---

## ✅ Solution

### 1. Created Error Extraction Helper

**File:** `apps/mobile/src/hooks/useRealtime.ts`

```typescript
/**
 * Extract detailed error message from Supabase Edge Function response
 * When an Edge Function returns a non-2xx status, the actual error details
 * are in error.context, not just error.message
 */
function extractEdgeFunctionError(error: any, result: any, fallback: string): string {
  // Priority 1: Check if result has error field (from Edge Function response body)
  if (result?.error) {
    return result.error;
  }
  
  // Priority 2: Check error.context.status for HTTP status code
  if (error?.context?.status) {
    const status = error.context.status;
    const statusText = error.context.statusText || '';
    return `HTTP ${status}${statusText ? ': ' + statusText : ''}`;
  }
  
  // Priority 3: Use error.message (usually "Edge Function returned a non-2xx status code")
  if (error?.message && error.message !== 'Edge Function returned a non-2xx status code') {
    return error.message;
  }
  
  // Fallback
  return fallback;
}
```

### 2. Updated player-pass Error Handling

**Before:**
```typescript
if (passError || !result?.success) {
  const errorMessage = passError?.message || result?.error || 'Server validation failed';
  gameLogger.error('[useRealtime] ❌ Pass failed:', errorMessage);
  throw new Error(errorMessage);
}
```

**After:**
```typescript
if (passError || !result?.success) {
  const errorMessage = extractEdgeFunctionError(passError, result, 'Pass validation failed');
  const statusCode = passError?.context?.status || 'unknown';
  
  gameLogger.error('[useRealtime] ❌ Pass failed:', {
    message: errorMessage,
    status: statusCode,
    fullError: passError,
    result: result,
  });
  
  throw new Error(errorMessage);
}
```

### 3. Updated play-cards Error Handling

**Before:**
```typescript
if (playError || !result?.success) {
  const errorMessage = playError?.message || result?.error || 'Server validation failed';
  const debugInfo = result?.debug ? JSON.stringify(result.debug) : 'No debug info';
  gameLogger.error('[useRealtime] ❌ Server validation failed:', errorMessage);
  gameLogger.error('[useRealtime] 🐛 Debug info:', debugInfo);
  gameLogger.error('[useRealtime] 📦 Full result:', JSON.stringify(result));
  throw new Error(errorMessage);
}
```

**After:**
```typescript
if (playError || !result?.success) {
  const errorMessage = extractEdgeFunctionError(playError, result, 'Server validation failed');
  const debugInfo = result?.debug ? JSON.stringify(result.debug) : 'No debug info';
  const statusCode = playError?.context?.status || 'unknown';
  
  gameLogger.error('[useRealtime] ❌ Server validation failed:', {
    message: errorMessage,
    status: statusCode,
    debug: debugInfo,
  });
  gameLogger.error('[useRealtime] 📦 Full error context:', {
    error: playError,
    result: result,
  });
  
  throw new Error(errorMessage);
}
```

---

## 📊 Expected User Experience

### Before Fix
```
Error dialog: "Edge Function returned a non-2xx status code"
Console: [useRealtime] ❌ Pass failed: Edge Function returned a non-2xx status code
```
❌ User has no idea what went wrong

### After Fix
```
Error dialog: "Not your turn"
Console: [useRealtime] ❌ Pass failed: { message: "Not your turn", status: 400 }
```
✅ Clear, actionable error message

### Possible Error Messages

**player-pass Edge Function errors:**
- "Not your turn" (status 400)
- "Cannot pass when leading" (status 400)
- "Room not found" (status 404)
- "Game state not found" (status 404)
- "Player not found in room" (status 404)

**play-cards Edge Function errors:**
- "Not your turn" (status 400)
- "Invalid cards" (status 400)
- "Cannot beat current play" (status 400)
- "Must play 3 of Diamonds on first turn" (status 400)
- "Room not found" (status 404)

---

## 🧪 Testing

### Test Case 1: Pass When Leading
1. Start a new match
2. As the first player, try to pass
3. **Expected:** Error shows "Cannot pass when leading" ✅

### Test Case 2: Pass When Not Your Turn
1. Join a multiplayer game
2. Try to pass when it's another player's turn
3. **Expected:** Error shows "Not your turn" ✅

### Test Case 3: Invalid Room Code
1. Manually trigger edge function with invalid room code
2. **Expected:** Error shows "Room not found" with status 404 ✅

---

## 📝 Changes Made

| File | Lines Changed | Description |
|------|---------------|-------------|
| `apps/mobile/src/hooks/useRealtime.ts` | +28, ~20 | Added error extraction helper, updated error handling |

---

## ✅ Verification Checklist

- [x] Helper function extracts error from `result.error` (Priority 1)
- [x] Helper function extracts HTTP status from `error.context.status` (Priority 2)
- [x] Helper function handles generic message fallback (Priority 3)
- [x] `player-pass` error handling updated
- [x] `play-cards` error handling updated
- [x] Logging includes HTTP status code
- [x] No TypeScript errors

---

## 🔗 Related Documentation

- [pushNotificationTriggers.ts](../apps/mobile/src/services/pushNotificationTriggers.ts#L39) - Original pattern for extracting error context
- [CRITICAL_BUG_FIX_CARD_ID_FORMAT_DEC_30_2025.md](./CRITICAL_BUG_FIX_CARD_ID_FORMAT_DEC_30_2025.md) - Similar issue with generic error messages

---

## 🎯 Impact

**Before:**
- 😕 Users see "Edge Function returned a non-2xx status code"
- 🤷 Developers have to check Supabase logs to diagnose issues
- 💸 Wasted time debugging production errors

**After:**
- ✅ Users see actual error message (e.g., "Not your turn")
- 🔍 Console logs show HTTP status codes for debugging
- 🚀 Faster issue resolution

---

**Status:** ✅ COMPLETE - Ready for testing
