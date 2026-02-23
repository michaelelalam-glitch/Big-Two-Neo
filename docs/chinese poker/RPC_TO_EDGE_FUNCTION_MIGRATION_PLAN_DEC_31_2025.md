# RPC to Edge Function Migration Plan
**Date:** December 31, 2025
**Status:** In Progress

## Executive Summary
Migration from Supabase RPC functions to Edge Functions for realtime multiplayer game functionality.

## Current State Analysis

### ✅ Already Migrated to Edge Functions
1. **play-cards** - Card playing logic
2. **player-pass** - Player pass action
3. **start_new_match** - New match initialization
4. **complete-game** - Game completion
5. **send-push-notification** - Push notifications

### ❌ Still Using RPC (Need Migration)

#### Matchmaking Operations
1. **find_match** - Match finding with skill-based matching
   - Used in: `useMatchmaking.ts` (lines 96, 146)
   - Complexity: HIGH (creates rooms, adds players, starts games)
   - Priority: HIGH

2. **cancel_matchmaking** - Cancel matchmaking request
   - Used in: `useMatchmaking.ts` (line 266)
   - Complexity: LOW
   - Priority: MEDIUM

#### Connection Management
3. **update_player_heartbeat** - Heartbeat to keep connection alive
   - Used in: `useConnectionManager.ts` (line 59)
   - Complexity: LOW
   - Priority: HIGH (critical for realtime)

4. **mark_player_disconnected** - Mark player as disconnected
   - Used in: `useConnectionManager.ts` (line 81)
   - Complexity: LOW
   - Priority: HIGH (critical for realtime)

5. **reconnect_player** - Reconnect disconnected player
   - Used in: `useConnectionManager.ts` (line 102)
   - Complexity: MEDIUM
   - Priority: HIGH (critical for realtime)

#### Utility Functions
6. **server_time_ms** - Get server timestamp
   - Used in: `useRealtime.ts` (line 43)
   - Complexity: VERY LOW
   - Priority: LOW (simple utility)

7. **delete_user_account** - Delete user account
   - Used in: `SettingsScreen.tsx` (line 243)
   - Complexity: MEDIUM
   - Priority: LOW (not game-critical)

#### Test Functions (Keep as RPC)
8. **execute_pass_move** - Test function
9. **execute_play_move** - Test function
10. **test_cleanup_user_data** - Test function

## Migration Strategy

### Phase 1: Connection Management (CRITICAL)
**Priority:** HIGHEST - These are essential for realtime multiplayer

1. Create `update-heartbeat` Edge Function
2. Create `mark-disconnected` Edge Function
3. Create `reconnect-player` Edge Function
4. Update `useConnectionManager.ts` to use new Edge Functions

### Phase 2: Matchmaking (HIGH PRIORITY)
**Priority:** HIGH - Core gameplay feature

1. Create `find-match` Edge Function (complex)
2. Create `cancel-matchmaking` Edge Function (simple)
3. Update `useMatchmaking.ts` to use new Edge Functions

### Phase 3: Utilities (LOWER PRIORITY)
**Priority:** MEDIUM/LOW - Nice to have

1. Create `server-time` Edge Function
2. Create `delete-account` Edge Function (optional)
3. Update respective client files

### Phase 4: Testing
1. Test all Edge Functions individually
2. Test full multiplayer flow
3. Test reconnection scenarios
4. Performance testing

## Implementation Plan

### Step 1: Create Connection Management Edge Functions ✓ NEXT

#### 1.1 update-heartbeat Edge Function
```typescript
// Location: supabase/functions/update-heartbeat/index.ts
// Purpose: Update player's last_seen_at timestamp
// Input: { room_id, player_id }
// Output: { success: boolean }
```

#### 1.2 mark-disconnected Edge Function
```typescript
// Location: supabase/functions/mark-disconnected/index.ts
// Purpose: Mark player as disconnected
// Input: { room_id, player_id }
// Output: { success: boolean }
```

#### 1.3 reconnect-player Edge Function
```typescript
// Location: supabase/functions/reconnect-player/index.ts
// Purpose: Reconnect previously disconnected player
// Input: { room_id, player_id }
// Output: { success: boolean, was_bot: boolean }
```

### Step 2: Create Matchmaking Edge Functions

#### 2.1 find-match Edge Function
```typescript
// Location: supabase/functions/find-match/index.ts
// Purpose: Find match for player with skill-based matching
// Input: { username, skill_rating, region, match_type }
// Output: { matched: boolean, room_id?, room_code?, waiting_count }
```

#### 2.2 cancel-matchmaking Edge Function
```typescript
// Location: supabase/functions/cancel-matchmaking/index.ts
// Purpose: Cancel matchmaking request
// Input: { user_id }
// Output: { success: boolean }
```

### Step 3: Create Utility Edge Functions

#### 3.1 server-time Edge Function
```typescript
// Location: supabase/functions/server-time/index.ts
// Purpose: Get server timestamp
// Input: {}
// Output: { timestamp: number }
```

#### 3.2 delete-account Edge Function (Optional)
```typescript
// Location: supabase/functions/delete-account/index.ts
// Purpose: Delete user account and all associated data
// Input: {}
// Output: { success: boolean }
```

### Step 4: Update Client Code

#### 4.1 Update useConnectionManager.ts
- Replace RPC calls with Edge Function invocations
- Update error handling
- Test connection scenarios

#### 4.2 Update useMatchmaking.ts
- Replace RPC calls with Edge Function invocations
- Update error handling
- Test matchmaking flow

#### 4.3 Update useRealtime.ts
- Replace server_time_ms RPC with Edge Function
- Test timing synchronization

#### 4.4 Update SettingsScreen.tsx
- Replace delete_user_account RPC with Edge Function
- Test account deletion

## Execution Order

1. ✅ **COMPLETED:** Assess current state
2. 🔄 **IN PROGRESS:** Create migration plan document
3. ⏳ **NEXT:** Create connection management Edge Functions
4. ⏳ Update useConnectionManager.ts
5. ⏳ Test connection management
6. ⏳ Create matchmaking Edge Functions
7. ⏳ Update useMatchmaking.ts
8. ⏳ Test matchmaking
9. ⏳ Create utility Edge Functions
10. ⏳ Update remaining client files
11. ⏳ Full integration testing
12. ✅ **COMPLETE:** Mark migration as complete

## Success Criteria

- [ ] All connection management operations use Edge Functions
- [ ] All matchmaking operations use Edge Functions
- [ ] No RPC calls remain in production code (excluding test helpers)
- [ ] All Edge Functions handle errors gracefully
- [ ] Realtime multiplayer works end-to-end
- [ ] Performance is equal or better than RPC
- [ ] Documentation is updated

## Risk Mitigation

1. **Performance:** Monitor Edge Function cold start times
2. **Complexity:** Test each function individually before integration
3. **Rollback:** Keep RPC functions in database until full migration tested
4. **Data Integrity:** Use transactions where needed
5. **Auth:** Ensure proper JWT validation in all Edge Functions

## Notes

- Test functions (execute_pass_move, execute_play_move, test_cleanup_user_data) should remain as RPC for now
- Edge Functions provide better TypeScript support and easier testing
- CORS headers must be consistent across all Edge Functions
- Service role key usage must be carefully managed for security
