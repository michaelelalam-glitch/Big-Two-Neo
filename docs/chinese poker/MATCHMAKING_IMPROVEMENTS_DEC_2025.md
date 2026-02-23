# Matchmaking System Improvements - December 2025

## Overview
Complete overhaul of the casual matchmaking system to provide an instant-play experience with shareable room codes.

## Problems Solved

### 1. ❌ 4th Player Went to Lobby Instead of Game
**Problem**: When the 4th player joined a matchmaking room, all players were redirected to the Lobby screen to wait for game start. This created unnecessary friction.

**Solution**: 
- Modified `find_match()` RPC function to create rooms with `status='playing'` instead of `status='starting'` when 4 players are matched
- Added `auto_started` boolean flag to indicate when game starts automatically
- Updated `useMatchmaking` hook to return the `autoStarted` flag
- Modified `MatchmakingScreen` to navigate directly to `GameScreen` when `autoStarted=true`

**Files Changed**:
- `apps/mobile/supabase/migrations/20251223000004_auto_start_matchmaking_games_v2.sql` - Updated RPC
- `apps/mobile/src/hooks/useMatchmaking.ts` - Added autoStarted flag
- `apps/mobile/src/screens/MatchmakingScreen.tsx` - Conditional navigation

### 2. ❌ No Shareable Room Code for Casual Matchmaking
**Problem**: Players couldn't invite friends to join their casual matchmaking rooms. The room code was hidden during matchmaking.

**Solution**:
- Added room code display in `MatchmakingScreen` when waiting for players (< 4 players)
- Room code appears in a styled box with instructions for friends to use "Join Room" feature
- Code is visible while searching but hidden when game auto-starts

**Files Changed**:
- `apps/mobile/src/screens/MatchmakingScreen.tsx` - Added room code display UI
- `apps/mobile/src/i18n/index.ts` - Added translations for "shareWithFriends" and "friendsCanJoin"

### 3. ✅ Start with AI Bots Already Working
**Status**: The "Start with AI Bots" button was already implemented for matchmaking rooms via `isMatchmakingRoom` flag.

**Verification**:
- `LobbyScreen.tsx` shows button when `(isHost || isMatchmakingRoom)` is true
- All translations present (EN/DE/AR)
- Added `matchmakingRoomInfo` translation for clarity

### 4. ✅ Rejoin Goes Directly to Game
**Status**: Already fixed in previous session. When user rejoins a room with `status='playing'`, they navigate directly to `GameScreen`.

**Files**:
- `apps/mobile/src/screens/HomeScreen.tsx` - `handleRejoin` checks status and navigates accordingly

---

## Technical Changes

### Database Migration (20251223000004_auto_start_matchmaking_games_v2.sql)

```sql
DROP FUNCTION IF EXISTS find_match(uuid, text, integer, text);

CREATE OR REPLACE FUNCTION find_match(
  p_user_id uuid,
  p_username text,
  p_skill_rating integer,
  p_region text
)
RETURNS TABLE(
  matched boolean,
  room_id uuid,
  room_code text,
  waiting_count integer,
  auto_started boolean  -- NEW COLUMN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_waiting_players waiting_room[];
  v_new_room_code text;
  v_new_room_id uuid;
BEGIN
  -- ... existing logic ...
  
  IF array_length(v_waiting_players, 1) >= 4 THEN
    -- CREATE ROOM WITH STATUS 'playing' (not 'starting')
    INSERT INTO rooms (code, host_id, status, max_players, fill_with_bots, is_matchmaking, is_public)
    VALUES (v_new_room_code, (v_waiting_players[1]).user_id, 'playing', 4, FALSE, TRUE, TRUE)
    RETURNING id INTO v_new_room_id;
    
    -- Return auto_started = TRUE
    RETURN QUERY SELECT TRUE, v_new_room_id, v_new_room_code, 4, TRUE as auto_started;
  END IF;
END;
$$;
```

### useMatchmaking Hook Updates

**Interface**:
```typescript
export interface MatchResult {
  matched: boolean;
  room_id?: string;
  room_code?: string;
  waiting_count: number;
  auto_started?: boolean;  // NEW
}

export interface UseMatchmakingReturn {
  isSearching: boolean;
  waitingCount: number;
  matchFound: boolean;
  roomCode: string | null;
  roomId: string | null;
  autoStarted: boolean;  // NEW
  error: string | null;
  startMatchmaking: (username: string, skillRating: number, region: string, matchType?: string) => Promise<void>;
  cancelMatchmaking: () => Promise<void>;
  resetMatch: () => void;
}
```

**State Management**:
```typescript
const [autoStarted, setAutoStarted] = useState(false);

// Set flag when match found
if (result.matched) {
  setMatchFound(true);
  setRoomCode(result.room_code);
  setRoomId(result.room_id);
  setAutoStarted(result.auto_started || false);  // NEW
  setIsSearching(false);
  setWaitingCount(4);
}
```

### MatchmakingScreen Navigation Logic

```typescript
const {
  isSearching,
  waitingCount,
  matchFound,
  roomCode,
  autoStarted,  // NEW
  error,
  startMatchmaking,
  cancelMatchmaking,
  resetMatch,
} = useMatchmaking();

// Navigate to lobby or game when match found
useEffect(() => {
  if (matchFound && roomCode) {
    resetMatch();
    
    // NEW: Conditional navigation
    if (autoStarted) {
      navigation.replace('Game', { roomCode });  // Skip lobby
    } else {
      navigation.replace('Lobby', { roomCode });  // Wait in lobby
    }
  }
}, [matchFound, roomCode, autoStarted, navigation, resetMatch]);
```

### Room Code Display UI

```tsx
{/* Room Code Display (for sharing) */}
{roomCode && waitingCount < 4 && (
  <View style={styles.roomCodeContainer}>
    <Text style={styles.roomCodeLabel}>
      🔗 {i18n.t('matchmaking.shareWithFriends')}
    </Text>
    <View style={styles.roomCodeBox}>
      <Text style={styles.roomCodeText}>{roomCode}</Text>
    </View>
    <Text style={styles.roomCodeHint}>
      {i18n.t('matchmaking.friendsCanJoin')}
    </Text>
  </View>
)}
```

**Styles**:
```typescript
roomCodeContainer: {
  width: '100%',
  backgroundColor: 'rgba(59, 130, 246, 0.1)',
  borderWidth: 1,
  borderColor: 'rgba(59, 130, 246, 0.3)',
  borderRadius: 12,
  padding: SPACING.md,
  marginBottom: SPACING.lg,
  alignItems: 'center',
},
roomCodeBox: {
  backgroundColor: COLORS.gray.dark,
  paddingHorizontal: SPACING.lg,
  paddingVertical: SPACING.sm,
  borderRadius: 8,
  marginBottom: SPACING.xs,
},
roomCodeText: {
  fontSize: FONT_SIZES.xl,
  color: COLORS.white,
  fontWeight: '700',
  letterSpacing: 4,
  fontFamily: 'monospace',
},
```

### i18n Translations Added

**Type Definition**:
```typescript
matchmaking: {
  // ... existing fields ...
  shareWithFriends: string;
  friendsCanJoin: string;
}

lobby: {
  // ... existing fields ...
  matchmakingRoomInfo: string;
}
```

**English**:
```typescript
matchmaking: {
  shareWithFriends: 'Share Room Code with Friends',
  friendsCanJoin: 'Friends can join this room using "Join Room"',
}
lobby: {
  matchmakingRoomInfo: 'Anyone can start this matchmaking game',
}
```

**Arabic**:
```typescript
matchmaking: {
  shareWithFriends: 'شارك رمز الغرفة مع الأصدقاء',
  friendsCanJoin: 'يمكن للأصدقاء الانضمام إلى هذه الغرفة باستخدام "الانضمام إلى الغرفة"',
}
lobby: {
  matchmakingRoomInfo: 'يمكن لأي شخص بدء هذه اللعبة',
}
```

**German**:
```typescript
matchmaking: {
  shareWithFriends: 'Raumcode mit Freunden teilen',
  friendsCanJoin: 'Freunde können diesem Raum mit "Raum beitreten" beitreten',
}
lobby: {
  matchmakingRoomInfo: 'Jeder kann dieses Matchmaking-Spiel starten',
}
```

---

## User Flow After Changes

### Scenario 1: 4 Players Matched Instantly
```
User clicks "Find Match"
↓
MatchmakingScreen shows searching... (0/4)
↓
4 players found instantly!
↓
Database creates room with status='playing'
↓
find_match() returns auto_started=true
↓
MatchmakingScreen navigates to GameScreen directly
↓
Game starts immediately! 🎮
```

### Scenario 2: User Joins Queue, Waits, Shares Code
```
User clicks "Find Match"
↓
MatchmakingScreen shows searching... (1/4)
↓
Room code displayed: "A1B2C3"
↓
User shares code with friend via WhatsApp
↓
Friend opens app, clicks "Join Room", enters "A1B2C3"
↓
Friend joins casual matchmaking room (2/4)
↓
When 4 players joined → auto-start to GameScreen
```

### Scenario 3: Less Than 4 Players, User Starts with Bots
```
User clicks "Find Match"
↓
MatchmakingScreen shows searching... (2/4)
↓
User sees room code displayed
↓
User waits 30 seconds, decides not to wait
↓
MatchmakingScreen navigates to LobbyScreen
↓
LobbyScreen shows "Start with AI Bots" button (isMatchmakingRoom=true)
↓
User clicks button → Game starts with 2 humans + 2 bots
```

---

## Testing Checklist

- [x] TypeScript compilation (no errors)
- [ ] 4-player instant match navigates to Game (not Lobby)
- [ ] Room code visible while waiting (< 4 players)
- [ ] Room code hidden when game auto-starts
- [ ] Friends can join via "Join Room" with shared code
- [ ] "Start with AI Bots" shows in casual matchmaking lobby
- [ ] Rejoin navigates to Game when status='playing'
- [ ] All translations display correctly (EN/DE/AR)

---

## Files Modified

1. **apps/mobile/supabase/migrations/20251223000004_auto_start_matchmaking_games_v2.sql**
   - Updated `find_match()` RPC to return `auto_started` flag
   - Create rooms with `status='playing'` when 4 players matched

2. **apps/mobile/src/hooks/useMatchmaking.ts**
   - Added `auto_started?: boolean` to `MatchResult` interface
   - Added `autoStarted: boolean` to `UseMatchmakingReturn` interface
   - Added `autoStarted` state variable
   - Set `autoStarted` when match found (two locations)
   - Return `autoStarted` in hook result

3. **apps/mobile/src/screens/MatchmakingScreen.tsx**
   - Destructured `autoStarted` from `useMatchmaking()`
   - Updated navigation useEffect to check `autoStarted` flag
   - Added room code display UI (conditional on `roomCode && waitingCount < 4`)
   - Added styles: `roomCodeContainer`, `roomCodeBox`, `roomCodeText`, `roomCodeLabel`, `roomCodeHint`

4. **apps/mobile/src/i18n/index.ts**
   - Added `shareWithFriends: string` to `matchmaking` interface
   - Added `friendsCanJoin: string` to `matchmaking` interface
   - Added `matchmakingRoomInfo: string` to `lobby` interface
   - Added EN translations for all 3 new keys
   - Added AR translations for all 3 new keys
   - Added DE translations for all 3 new keys

---

## Known Limitations

1. Room code is plain text (no copy-to-clipboard button yet)
2. No QR code generation for room sharing
3. No "Invite Friend" direct share button (future feature)
4. Room code displayed even if user is alone in queue (could be confusing)

---

## Future Improvements

1. **Copy-to-Clipboard Button**: Add button to copy room code
2. **Direct Share**: Use React Native Share API to share room code via WhatsApp/SMS
3. **QR Code**: Generate QR code for easy scanning between devices
4. **Room Code Validation**: Ensure room code is valid before displaying
5. **Analytics**: Track how many users share codes vs. wait for matchmaking

---

## Summary

✅ **All 4 requirements completed**:
1. ✅ Rejoin goes directly to GameScreen (already done)
2. ✅ Casual matchmaking shows "Start with AI Bots" button (already done)
3. ✅ Shareable room code displayed during matchmaking
4. ✅ 4th player auto-starts game, skips lobby

**Result**: Casual matchmaking now provides instant-play experience with friend-sharing capability!
