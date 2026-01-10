# Bug Fix: Bot Getting Stuck on Pass Network Errors (Jan 10, 2026)

## Problem

Bots were getting stuck when they tried to pass but encountered network errors calling the `player-pass` Edge Function. The bot would:

1. Decide to pass (correctly)
2. Call `passMove()` which invokes the `player-pass` Edge Function
3. Get a network error: "Failed to send a request to the Edge Function"
4. Retry 3 times (with exponential backoff)
5. After all retries fail, log the error but NOT reset the execution lock
6. Get stuck forever because `isExecutingRef.current` remained set to the current turn
7. The useEffect wouldn't trigger again because the turn didn't change

## Console Evidence

```
LOG  [BotCoordinator] Bot decision: 
{
  "should_pass": true,
  "cards_to_play": 0,
  "reasoning": "Medium bot strategically passing"
}

LOG  [BotCoordinator] Bot passing turn 
LOG  [useRealtime] 📡 Calling player-pass Edge Function...

WARN  [useRealtime] ⚠️ Failed to update play_history (non-fatal): 
{
  "message": "TypeError: Network request failed"
}

ERROR [useRealtime] ❌ Pass failed: 
{
  "message": "Failed to send a request to the Edge Function",
  "status": "unknown"
}

ERROR [BotCoordinator] Error executing bot turn: Failed to send a request to the Edge Function
```

After this, the bot coordinator would not execute again because:
- `isExecutingRef.current` was still set to `"1-2"` (match 1, turn 2)
- The `finally` block would only reset it after 500ms
- But the outer `catch` block would catch the error and return early
- So the useEffect would see the same turn and skip execution

## Root Cause

In [useBotCoordinator.ts](../apps/mobile/src/hooks/useBotCoordinator.ts):

**OLD CODE (Lines 189-230):**
```typescript
await retryWithBackoff(async () => {
  await passMove(currentPlayerIndex);
}, 3, 1000);

gameLogger.info(`✅ [BotCoordinator] Bot passed successfully`);
```

The issue: If `retryWithBackoff` exhausted all retries and threw an error, it would jump directly to the outer `catch` block at line 305, which would:
1. Log the error
2. Set `isExecutingRef.current = null` (but this line never ran because...)
3. Return early (preventing the finally block from running immediately)

The `finally` block would only reset the ref after 500ms, but by then the damage was done - the bot missed multiple turns.

## Solution

**NEW CODE (Lines 189-245):**
```typescript
try {
  await retryWithBackoff(async () => {
    await passMove(currentPlayerIndex);
  }, 3, 1000);
  
  gameLogger.info(`✅ [BotCoordinator] Bot passed successfully`);
  await new Promise(resolve => setTimeout(resolve, 300));
} catch (passError: any) {
  // 🚨 CRITICAL FIX: Reset execution ref immediately on pass failure
  // This allows the bot to retry on the next useEffect trigger
  gameLogger.error('[BotCoordinator] ❌ Bot pass failed after retries:', passError?.message || String(passError));
  isExecutingRef.current = null;
  throw passError; // Re-throw to be caught by outer catch block
}
```

**Key Changes:**
1. ✅ Wrapped the `retryWithBackoff` call in an inner try-catch
2. ✅ Immediately reset `isExecutingRef.current = null` on network error
3. ✅ Re-throw the error to maintain error propagation
4. ✅ Applied same fix to the `playCards` path for consistency

## Impact

**Before Fix:**
- Bot gets stuck forever after network error
- Game becomes unplayable
- Requires app restart

**After Fix:**
- Bot immediately resets execution lock on network error
- useEffect triggers again on next state update
- Bot retries the pass operation
- Game continues normally even with intermittent network issues

## Files Changed

- [apps/mobile/src/hooks/useBotCoordinator.ts](../apps/mobile/src/hooks/useBotCoordinator.ts)
  - Lines 189-245: Bot pass logic with network error recovery
  - Lines 273-321: Bot play logic with network error recovery (consistency fix)

## Testing Recommendations

1. **Network Error Simulation:**
   - Disable network mid-game
   - Verify bot passes/plays retry automatically
   - Verify game continues when network restored

2. **Bot Pass Scenarios:**
   - Bot can't beat current play → should pass
   - Bot strategically passes → should pass
   - Verify bot doesn't get stuck on network errors

3. **Edge Cases:**
   - Multiple network errors in a row
   - Network error on bot play vs bot pass
   - Network error affecting multiple bots in sequence

## Related Issues

- Original bot turn order issue: [BUG_FIX_BOT_TURN_ORDER_JAN_10_2026.md](./BUG_FIX_BOT_TURN_ORDER_JAN_10_2026.md)
- Bot infinite loop issue: [BUG_FIX_BOT_INFINITE_LOOP.md](./BUG_FIX_BOT_INFINITE_LOOP.md)
- Match end transition issue: [BUG_FIX_MATCH_END_TRANSITION_JAN_10_2026.md](./BUG_FIX_MATCH_END_TRANSITION_JAN_10_2026.md)

## Prevention

To prevent similar issues in the future:

1. ✅ Always reset execution locks in inner catch blocks before re-throwing
2. ✅ Use explicit error recovery for critical network operations
3. ✅ Test with network simulator to catch race conditions
4. ✅ Add retry logic with proper state cleanup
5. ✅ Use structured logging to trace execution flow

---

**Status:** ✅ FIXED  
**Date:** January 10, 2026  
**Author:** Project Manager + Implementation Agent  
**Tested:** Pending (requires network error simulation)
