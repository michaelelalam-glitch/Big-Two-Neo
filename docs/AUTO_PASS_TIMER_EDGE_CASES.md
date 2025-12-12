# Auto-Pass Timer: Edge Cases & Error Handling

**Date:** December 12, 2025  
**Task:** #335 - Handle edge cases and update documentation  
**Status:** Complete ✅

---

## 📋 Overview

This document details edge case handling, error scenarios, and robustness measures for the auto-pass timer feature in Big Two Neo multiplayer games.

---

## 🎯 Edge Cases Identified

### 1. Player Disconnect During Active Timer

**Scenario:** Auto-pass timer is active (e.g., 7 seconds remaining) when a player disconnects.

**Expected Behavior:**
- ✅ Timer continues running on server
- ✅ Other connected players see timer countdown
- ✅ If disconnected player doesn't reconnect before timer expires → auto-pass executes
- ✅ If player reconnects → timer state is restored from `game_state.auto_pass_timer`

**Implementation:**
```typescript
// Server: Timer runs independently of player connections
//  The timer state is stored in game_state table
// Frontend: useRealtime hook fetches latest game_state on reconnect

// reconnect.ts
async function handleReconnect(roomId: string) {
  await joinChannel(roomId);
  await fetchGameState(roomId); // ← Restores timer state
  
  // UI component automatically renders timer if active
  if (gameState.auto_pass_timer?.active) {
    // AutoPassTimer component displays current countdown
  }
}
```

**Database State:**
```sql
-- game_state table maintains timer state
SELECT auto_pass_timer FROM game_state WHERE room_id = 'ABC123';
-- Result: { active: true, remaining_ms: 7000, ... }
```

---

### 2. Room Closure / Game End During Timer

**Scenario:** Room is closed or game ends while auto-pass timer is active.

**Expected Behavior:**
- ✅ Timer is immediately cancelled
- ✅ `auto_pass_timer` set to `null` in database
- ✅ No auto-pass execution occurs
- ✅ All clients receive cleanup event

**Implementation:**
```typescript
// When room closes
async function closeRoom(roomId: string) {
  // 1. Cancel active timer
  await supabase
    .from('game_state')
    .update({ auto_pass_timer: null })
    .eq('room_id', roomId);
  
  // 2. Clean up room
  await deleteRoom(roomId);
  
  // 3. Clients unsubscribe from channel
  // AutoPassTimer component automatically hides (timer is null)
}

// When game ends naturally
async function endGame(roomId: string, winnerId: string) {
  await supabase
    .from('game_state')
    .update({ 
      game_phase: 'finished',
      auto_pass_timer: null, // ← Clear timer
      winner_position: winnerId 
    })
    .eq('room_id', roomId);
}
```

---

### 3. Multiple Sequential Timers

**Scenario:** Back-to-back highest plays trigger multiple timers in succession.

**Example Game Flow:**
```
Turn 1: Player A plays 2♠ (highest single)
        → Auto-pass timer starts (10s)
        
Turn 2: Player B manually passes at 7s
        → Timer cancelled
        → auto_pass_timer_cancelled event
        
Turn 3: Player C plays 2♥-2♣ (highest remaining pair)
        → NEW auto-pass timer starts (10s)
        → auto_pass_timer_started event
        
Turn 4: Timer expires
        → auto_pass_executed for Player D
```

**Expected Behavior:**
- ✅ Each timer is independent
- ✅ Previous timer is cancelled before new one starts
- ✅ WebSocket events broadcast state changes
- ✅ UI updates correctly for each transition

**Implementation:**
```typescript
// Server: Always check and cancel existing timer before starting new one
async function playCards(roomId: string, cards: Card[]) {
  const gameState = await getGameState(roomId);
  
  // Cancel existing timer if active
  if (gameState.auto_pass_timer?.active) {
    await cancelTimer(roomId);
    await broadcastMessage('auto_pass_timer_cancelled', {
      player_index: currentPlayerIndex,
    });
  }
  
  // Check if new play triggers timer
  const isHighest = isHighestPossiblePlay(cards, gameState.played_cards);
  if (isHighest) {
    const newTimer = createAutoPassTimerState(lastPlay);
    await updateGameState(roomId, { auto_pass_timer: newTimer });
    await broadcastMessage('auto_pass_timer_started', {
      timer_state: newTimer,
      triggering_player_index: currentPlayerIndex
    });
  }
}
```

---

### 4. Manual Pass Cancels Timer

**Scenario:** Player manually passes while auto-pass timer is active.

**Expected Behavior:**
- ✅ Timer is immediately cancelled
- ✅ `auto_pass_timer_cancelled` event broadcast
- ✅ Game continues to next player
- ✅ Timer UI disappears

**Implementation:**
```typescript
// pass.ts
async function pass(roomId: string, playerId: string) {
  const gameState = await getGameState(roomId);
  
  // Cancel timer if active
  if (gameState.auto_pass_timer?.active) {
    await supabase
      .from('game_state')
      .update({ auto_pass_timer: null })
      .eq('room_id', roomId);
    
    await broadcastMessage('auto_pass_timer_cancelled', {
      player_index: getCurrentPlayerIndex(playerId),
    });
  }
  
  // Continue with normal pass logic
  await advanceTurn(roomId);
  await broadcastMessage('player_passed', {
    player_index: getCurrentPlayerIndex(playerId)
  });
}
```

**WebSocket Event Sequence:**
```javascript
1. auto_pass_timer_started (10s countdown begins)
2. auto_pass_timer_cancelled (player manually passed)
3. player_passed (turn advances)
4. turn_changed (next player's turn)
```

---

### 5. Timer Expiry (Auto-Pass Execution)

**Scenario:** No manual pass occurs within 10 seconds.

**Expected Behavior:**
- ✅ Server automatically passes for current player
- ✅ `auto_pass_executed` event broadcast
- ✅ Timer cleared from game state
- ✅ Turn advances to next player

**Implementation:**
```typescript
// Server-side timer callback
async function onTimerExpiry(roomId: string) {
  const gameState = await getGameState(roomId);
  const currentPlayer = gameState.current_turn;
  
  // Execute auto-pass
  await supabase
    .from('game_state')
    .update({ 
      auto_pass_timer: null,
      pass_count: gameState.pass_count + 1,
      current_turn: (currentPlayer + 1) % 4
    })
    .eq('room_id', roomId);
  
  // Broadcast events
  await broadcastMessage('auto_pass_executed', {
    player_index: currentPlayer
  });
  
  await broadcastMessage('turn_changed', {
    player_index: (currentPlayer + 1) % 4,
    timer: 30 // New turn timer
  });
  
  // Check if table should be cleared (3 consecutive passes)
  if (gameState.pass_count + 1 >= 3) {
    await clearTable(roomId);
  }
}
```

---

### 6. Network Partition / Temporary Disconnect

**Scenario:** Player loses network connection briefly, then reconnects.

**Expected Behavior:**
- ✅ Timer continues on server (unaffected by client disconnect)
- ✅ On reconnect, client fetches latest `game_state`
- ✅ UI renders timer with correct remaining time
- ✅ No duplicate timer creation

**Implementation:**
```typescript
// useRealtime.ts - Reconnection logic
const reconnect = useCallback(async () => {
  if (!room || reconnectAttemptsRef.current >= maxReconnectAttempts) return;
  
  reconnectAttemptsRef.current++;
  
  try {
    // Rejoin channel
    await joinChannel(room.id);
    
    // Fetch latest game state (includes timer)
    await fetchGameState(room.id);
    
    // AutoPassTimer component will render if timer is active
    // Uses updateTimerState() to calculate current remaining_ms
    
    reconnectAttemptsRef.current = 0;
    onReconnect?.();
  } catch (err) {
    setError(err as Error);
    onError?.(err as Error);
  }
}, [room, onReconnect, onError]);
```

**Timer State Restoration:**
```typescript
// AutoPassTimer component
useEffect(() => {
  if (!timerState || !timerState.active) return;
  
  // Calculate current remaining time from started_at timestamp
  const startedAt = new Date(timerState.started_at).getTime();
  const now = Date.now();
  const elapsed = now - startedAt;
  const remaining = Math.max(0, timerState.duration_ms - elapsed);
  
  setDisplaySeconds(Math.ceil(remaining / 1000));
}, [timerState]);
```

---

### 7. Concurrent Timer Operations

**Scenario:** Multiple operations (pass, play, disconnect) happen near-simultaneously.

**Expected Behavior:**
- ✅ Database transactions ensure consistency
- ✅ Only one timer state exists at a time
- ✅ Race conditions handled by database constraints
- ✅ Optimistic UI updates with rollback on conflict

**Database Safeguards:**
```sql
-- Use row-level locking for game_state updates
BEGIN;
  SELECT * FROM game_state WHERE room_id = 'ABC123' FOR UPDATE;
  -- Process timer logic
  UPDATE game_state SET auto_pass_timer = ... WHERE room_id = 'ABC123';
COMMIT;
```

---

## 🛡️ Error Handling

### 1. Database Write Failures

**Scenario:** Timer update fails to write to database.

**Handling:**
```typescript
async function startAutoPassTimer(roomId: string, timerState: AutoPassTimerState) {
  try {
    const { error } = await supabase
      .from('game_state')
      .update({ auto_pass_timer: timerState })
      .eq('room_id', roomId);
    
    if (error) {
      networkLogger.error('Failed to start auto-pass timer:', error);
      
      // Notify players of error
      await broadcastMessage('error', {
        message: 'Timer initialization failed',
        severity: 'warning'
      });
      
      // Continue game without timer (graceful degradation)
      return { success: false, error };
    }
    
    return { success: true };
  } catch (err) {
    networkLogger.error('Auto-pass timer exception:', err);
    return { success: false, error: err };
  }
}
```

### 2. WebSocket Broadcast Failures

**Scenario:** Timer event fails to broadcast to all clients.

**Handling:**
```typescript
async function broadcastTimerEvent(event: BroadcastEvent, payload: any) {
  try {
    await channelRef.current?.send({
      type: 'broadcast',
      event,
      payload
    });
  } catch (err) {
    networkLogger.error('Broadcast failed:', err);
    
    // Fallback: Clients will sync on next poll/reconnect
    // game_state is source of truth
  }
}
```

### 3. Invalid Timer State

**Scenario:** Timer state is corrupted or invalid.

**Handling:**
```typescript
function validateTimerState(state: any): state is AutoPassTimerState {
  return (
    typeof state === 'object' &&
    typeof state.active === 'boolean' &&
    typeof state.started_at === 'string' &&
    typeof state.duration_ms === 'number' &&
    typeof state.remaining_ms === 'number' &&
    state.triggering_play !== null
  );
}

// Usage
if (gameState.auto_pass_timer && !validateTimerState(gameState.auto_pass_timer)) {
  networkLogger.error('Invalid timer state, clearing');
  await clearTimer(roomId);
}
```

---

## 🧪 Testing Edge Cases

### Test Suite Structure

```typescript
describe('Auto-Pass Timer Edge Cases', () => {
  describe('Player Disconnect', () => {
    it('should continue timer when player disconnects');
    it('should restore timer state on reconnect');
    it('should auto-pass if player doesnt reconnect in time');
  });
  
  describe('Room Closure', () => {
    it('should cancel timer when room closes');
    it('should cancel timer when game ends');
  });
  
  describe('Sequential Timers', () => {
    it('should handle back-to-back timer triggers');
    it('should cancel old timer before starting new one');
  });
  
  describe('Manual Pass Cancellation', () => {
    it('should cancel timer on manual pass');
    it('should broadcast cancellation event');
  });
  
  describe('Network Failures', () => {
    it('should handle database write failures gracefully');
    it('should recover from broadcast failures');
    it('should validate timer state before rendering');
  });
});
```

---

## 📊 Monitoring & Debugging

### Logging Strategy

```typescript
// Timer lifecycle logging
networkLogger.debug('Auto-pass timer started', {
  roomId,
  duration_ms: 10000,
  triggering_play: { cards, combo_type },
  timestamp: new Date().toISOString()
});

networkLogger.debug('Auto-pass timer cancelled', {
  roomId,
  reason: 'manual_pass',
  remaining_ms: state.remaining_ms
});

networkLogger.debug('Auto-pass executed', {
  roomId,
  player_index,
  was_disconnected: !isPlayerConnected
});
```

### Metrics to Track

- Timer creation count
- Timer cancellation rate (manual vs. expiry)
- Average remaining time when cancelled
- Reconnection during active timer frequency
- Edge case occurrence rate

---

## ✅ Edge Case Handling Checklist

- ✅ Player disconnect during timer → Timer continues, state restored on reconnect
- ✅ Room closure during timer → Timer cancelled immediately
- ✅ Game end during timer → Timer cleared, no auto-pass
- ✅ Sequential timers → Each timer independent, old one cancelled
- ✅ Manual pass during timer → Timer cancelled, event broadcast
- ✅ Timer expiry → Auto-pass executed, turn advances
- ✅ Network partition → Timer unaffected, state restored
- ✅ Concurrent operations → Database locking ensures consistency
- ✅ Database failures → Graceful degradation, error logging
- ✅ Invalid state → Validation and auto-cleanup
- ✅ All events properly broadcast → Clients stay synchronized

---

## 🎯 Summary

The auto-pass timer is designed to be **robust, fault-tolerant, and recoverable** from all edge cases. Key principles:

1. **Server is Source of Truth** - Timer state in database, clients render from state
2. **Graceful Degradation** - Errors don't crash game, just disable timer
3. **Event-Driven Sync** - WebSocket events keep all clients updated
4. **State Restoration** - Reconnecting players get current timer state
5. **Database Transactions** - Prevent race conditions and inconsistencies

All edge cases handled with comprehensive error logging and recovery mechanisms.

---
📋 Auto-Pass Timer Feature - Task Plan Created
Phase 1: Backend Core (HIGH Priority)
⚡ Task #340 - Research and design highest play detection algorithm
⚡ Task #339 - Implement highest play detection logic
⚡ Task #338 - Add auto-pass timer state management
⚡ Task #337 - Implement timer scheduler with auto-pass execution
⚡ Task #336 - Add WebSocket events for auto-pass timer

Phase 2: Frontend Integration (MEDIUM Priority)
📌 Task #334 - Design and implement timer UI component
📌 Task #333 - Connect WebSocket events to frontend timer UI
📌 Task #331 - Ensure manual pass cancels auto-pass timer

Phase 3: Quality & Documentation (MEDIUM Priority)
📌 Task #332 - Write comprehensive tests for auto-pass timer
📌 Task #335 - Handle edge cases and update documentation


**Documentation Complete** ✅
