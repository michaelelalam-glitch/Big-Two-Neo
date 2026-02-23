# Unified Game Architecture Implementation Plan
## December 25, 2025 - Production-Ready Multiplayer System

**Status:** PLANNING  
**Objective:** Create unified game system supporting all player/bot combinations with production-ready infrastructure  
**Timeline:** 3-4 weeks (Phases 1-3)  
**PR Target:** Single comprehensive PR after Phase 3 complete

---

## 🎯 Core Requirements

### Game Modes (All Must Work Together)
- ✅ **Mode 1:** Solo player + 3 AI bots (offline-capable)
- ✅ **Mode 2:** 4 human players (online multiplayer)
- ✅ **Mode 3:** Mixed humans + AI bots (2+2, 3+1, etc.)

### Critical Fixes
- ✅ Requirement 2: 2 humans + 2 AI bots
- ✅ Requirement 3: 3 humans + 1 AI bot
- ✅ Requirement 5: Casual "Start with AI" working correctly
- ✅ Requirement 6: Host dynamics with proper UI

### Architecture Components
1. **Unified Game System** - Single engine supporting humans + bots
2. **Bot Coordinator** - Multiplayer bot AI execution
3. **Smart Routing** - Context-aware navigation
4. **Database RPC Functions** - Server-side bot support
5. **Offline Practice Mode** - No auth, no room creation, AsyncStorage only
6. **Unified Game Lobby** - Consistent UI for all game types
7. **Ready System** - All players ready before game starts
8. **Rejoin System** - Banner on home page, seamless reconnection
9. **Production-Ready Room Codes** - Scalable reuse system, no confusing characters

---

## Phase 1: Hybrid Game Engine & Bot Coordinator (Week 1-2)

### 1.1 Database Schema & RPC Functions

#### A. Update Room Code Generation (Production-Ready)
**File:** `apps/mobile/supabase/migrations/20251225000001_unified_game_architecture.sql`

**Changes:**
```sql
-- Part 1: Production-ready room code generation
-- Exclude confusing characters: 1, I, 0, O
-- Use base32-like charset: 23456789ABCDEFGHJKLMNPQRSTUVWXYZ (32 chars)
CREATE OR REPLACE FUNCTION generate_room_code_v2()
RETURNS VARCHAR AS $$
DECLARE
  chars TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  result VARCHAR := '';
  i INTEGER;
  max_attempts INTEGER := 100;
  attempt INTEGER := 0;
BEGIN
  LOOP
    result := '';
    FOR i IN 1..6 LOOP
      result := result || substr(chars, floor(random() * 32 + 1)::integer, 1);
    END LOOP;
    
    -- Check if code exists
    IF NOT EXISTS (SELECT 1 FROM rooms WHERE code = result) THEN
      RETURN result;
    END IF;
    
    attempt := attempt + 1;
    IF attempt >= max_attempts THEN
      RAISE EXCEPTION 'Failed to generate unique room code after % attempts', max_attempts;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Part 2: Room code recycling for production scale
-- Delete abandoned rooms (waiting > 2 hours, no activity)
CREATE OR REPLACE FUNCTION cleanup_abandoned_rooms()
RETURNS void AS $$
BEGIN
  DELETE FROM rooms 
  WHERE status = 'waiting' 
  AND updated_at < NOW() - INTERVAL '2 hours'
  AND (SELECT COUNT(*) FROM room_players WHERE room_id = rooms.id) = 0;
  
  -- Delete completed rooms older than 30 days
  DELETE FROM rooms
  WHERE status IN ('completed', 'cancelled')
  AND updated_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup job (run every 6 hours)
-- Note: Use pg_cron extension if available, or trigger from Edge Function
COMMENT ON FUNCTION cleanup_abandoned_rooms() IS 'Call this from scheduled Edge Function every 6 hours';
```

#### B. Add Bot Support to Multiplayer Tables
```sql
-- Part 3: Bot support columns (if not exists)
ALTER TABLE players 
ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS bot_difficulty VARCHAR(10) DEFAULT 'medium' CHECK (bot_difficulty IN ('easy', 'medium', 'hard')),
ADD COLUMN IF NOT EXISTS bot_name VARCHAR(50);

ALTER TABLE room_players
ADD COLUMN IF NOT EXISTS bot_difficulty VARCHAR(10) DEFAULT 'medium';

ALTER TABLE rooms
ADD COLUMN IF NOT EXISTS bot_coordinator_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS ranked_mode BOOLEAN DEFAULT FALSE;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_players_is_bot ON players(room_id, is_bot);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_code_status ON rooms(code, status);

-- Comments
COMMENT ON COLUMN players.is_bot IS 'Whether this player is an AI bot (NULL user_id)';
COMMENT ON COLUMN rooms.bot_coordinator_id IS 'User ID of client coordinating bot moves (typically first human)';
COMMENT ON COLUMN rooms.ranked_mode IS 'Whether this is a ranked game (no bots at start, only replace disconnects)';
```

#### C. Create start_game_with_bots RPC Function
```sql
-- Part 4: Start game with mixed humans + bots
CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty VARCHAR DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_players RECORD[];
  v_bot_players RECORD[];
  v_all_players RECORD[];
  v_deck JSON;
  v_hands JSON;
  v_game_state JSON;
  v_player_count INTEGER;
  v_first_turn_index INTEGER;
  v_bot_index INTEGER;
  v_player_entry JSON;
  v_coordinator_id UUID;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found: %', p_room_id;
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RAISE EXCEPTION 'Room is not in waiting status: %', v_room.status;
  END IF;
  
  -- 2. Get existing human players
  SELECT COUNT(*) INTO v_player_count 
  FROM room_players 
  WHERE room_id = p_room_id AND NOT is_bot;
  
  -- 3. Validate player + bot count = 4
  IF v_player_count + p_bot_count != 4 THEN
    RAISE EXCEPTION 'Invalid player count: % humans + % bots != 4', v_player_count, p_bot_count;
  END IF;
  
  -- 4. Check if ranked mode - no bots allowed at start
  IF v_room.ranked_mode AND p_bot_count > 0 THEN
    RAISE EXCEPTION 'Ranked games cannot start with bots';
  END IF;
  
  -- 5. Set bot coordinator (first human player)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id AND NOT is_bot
  ORDER BY player_index ASC
  LIMIT 1;
  
  UPDATE rooms
  SET bot_coordinator_id = v_coordinator_id
  WHERE id = p_room_id;
  
  -- 6. Create bot players in room_players
  v_bot_index := 0;
  FOR v_bot_index IN 0..(p_bot_count - 1) LOOP
    -- Find next available player_index
    INSERT INTO room_players (
      room_id,
      player_index,
      is_bot,
      is_ready,
      bot_difficulty,
      joined_at
    )
    SELECT 
      p_room_id,
      COALESCE(
        (SELECT MIN(idx) 
         FROM generate_series(0, 3) idx
         WHERE idx NOT IN (SELECT player_index FROM room_players WHERE room_id = p_room_id)
        ),
        v_player_count + v_bot_index
      ),
      TRUE,
      TRUE, -- Bots are always ready
      p_bot_difficulty,
      NOW();
  END LOOP;
  
  -- 7. Update room status
  UPDATE rooms
  SET 
    status = 'playing',
    updated_at = NOW()
  WHERE id = p_room_id;
  
  -- 8. Return success with coordinator info
  RETURN json_build_object(
    'success', TRUE,
    'room_id', p_room_id,
    'bot_coordinator_id', v_coordinator_id,
    'human_count', v_player_count,
    'bot_count', p_bot_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS 'Start multiplayer game with mixed humans + AI bots';
```

#### D. Create Bot Replacement RPC (for Ranked Disconnects)
```sql
-- Part 5: Replace disconnected player with bot (ranked mode only)
CREATE OR REPLACE FUNCTION replace_disconnected_with_bot(
  p_room_id UUID,
  p_player_index INTEGER,
  p_disconnect_duration_seconds INTEGER DEFAULT 60
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_player RECORD;
  v_last_seen TIMESTAMPTZ;
BEGIN
  -- 1. Get room
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found';
  END IF;
  
  -- 2. Only allow in ranked mode
  IF NOT v_room.ranked_mode THEN
    RAISE EXCEPTION 'Bot replacement only allowed in ranked mode';
  END IF;
  
  -- 3. Get player from room_players
  SELECT * INTO v_player
  FROM room_players
  WHERE room_id = p_room_id 
  AND player_index = p_player_index
  AND NOT is_bot;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found or already a bot';
  END IF;
  
  -- 4. Check disconnect duration
  -- (Presence tracking handled by client, this validates time)
  v_last_seen := v_player.updated_at;
  
  IF EXTRACT(EPOCH FROM (NOW() - v_last_seen)) < p_disconnect_duration_seconds THEN
    RAISE EXCEPTION 'Player has not been disconnected long enough';
  END IF;
  
  -- 5. Replace with bot
  UPDATE room_players
  SET 
    is_bot = TRUE,
    bot_difficulty = 'medium',
    updated_at = NOW()
  WHERE room_id = p_room_id AND player_index = p_player_index;
  
  -- 6. Update players table (game state)
  UPDATE players
  SET 
    is_bot = TRUE,
    bot_difficulty = 'medium',
    bot_name = 'Bot ' || (p_player_index + 1)
  WHERE room_id = p_room_id AND position = p_player_index;
  
  RETURN json_build_object(
    'success', TRUE,
    'player_index', p_player_index,
    'replaced_user_id', v_player.user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION replace_disconnected_with_bot TO authenticated;
```

#### E. Add Ready System Check
```sql
-- Part 6: Check if all players are ready
CREATE OR REPLACE FUNCTION check_all_players_ready(p_room_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_total_players INTEGER;
  v_ready_players INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_players
  FROM room_players
  WHERE room_id = p_room_id;
  
  SELECT COUNT(*) INTO v_ready_players
  FROM room_players
  WHERE room_id = p_room_id AND is_ready = TRUE;
  
  RETURN v_total_players > 0 AND v_total_players = v_ready_players;
END;
$$ LANGUAGE plpgsql;

-- Part 7: Update ready status trigger to check for auto-start
CREATE OR REPLACE FUNCTION on_player_ready_check_autostart()
RETURNS TRIGGER AS $$
BEGIN
  -- If all players are ready, send notification via pg_notify
  IF check_all_players_ready(NEW.room_id) THEN
    PERFORM pg_notify(
      'room_ready_' || NEW.room_id::TEXT,
      json_build_object('all_ready', true)::TEXT
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_player_ready_autostart ON room_players;
CREATE TRIGGER trigger_player_ready_autostart
  AFTER UPDATE OF is_ready ON room_players
  FOR EACH ROW
  WHEN (NEW.is_ready = TRUE)
  EXECUTE FUNCTION on_player_ready_check_autostart();
```

---

### 1.2 Bot Coordinator Hook (Client-Side)

**File:** `apps/mobile/src/hooks/useBotCoordinator.ts` (NEW)

```typescript
import { useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { BotAI, type BotDifficulty } from '../game/bot';
import type { Card, ComboType, GameState } from '../game/types';
import { determineComboType } from '../game/combo';
import { gameLogger } from '../utils/logger';

interface UseBotCoordinatorProps {
  roomId: string;
  isCoordinator: boolean; // Only first human runs this
  gameState: GameState | null;
  enabled: boolean; // Only run during active game
}

/**
 * Bot Coordinator Hook
 * 
 * Responsible for executing bot AI in multiplayer context.
 * Only the HOST/COORDINATOR runs this logic to avoid conflicts.
 * 
 * Flow:
 * 1. Monitor game state for bot turns
 * 2. When bot's turn, calculate move with BotAI
 * 3. Broadcast move via RPC (play_cards/pass_turn)
 * 4. All clients see move via Realtime subscription
 * 
 * Design:
 * - Deterministic: Same game state → same bot move
 * - Synchronized: All clients see same bot behavior
 * - Coordinator-only: Prevents duplicate bot moves
 */
export function useBotCoordinator({
  roomId,
  isCoordinator,
  gameState,
  enabled,
}: UseBotCoordinatorProps) {
  const botAICache = useRef<Map<number, BotAI>>(new Map());
  const processingTurn = useRef<boolean>(false);
  
  useEffect(() => {
    if (!enabled || !isCoordinator || !gameState || processingTurn.current) {
      return;
    }
    
    const currentPlayer = gameState.players[gameState.currentTurn];
    
    // Only process if it's a bot's turn
    if (!currentPlayer?.is_bot) {
      return;
    }
    
    const executeBotTurn = async () => {
      processingTurn.current = true;
      gameLogger.info(`🤖 [Bot Coordinator] Processing turn for bot at position ${gameState.currentTurn}`);
      
      try {
        // Get or create BotAI instance
        let botAI = botAICache.current.get(gameState.currentTurn);
        if (!botAI) {
          const difficulty = (currentPlayer.bot_difficulty || 'medium') as BotDifficulty;
          botAI = new BotAI(difficulty);
          botAICache.current.set(gameState.currentTurn, botAI);
        }
        
        // Calculate bot move
        const botHand = currentPlayer.hand;
        const lastPlayed = gameState.lastPlayed;
        
        const move = botAI.playTurn(botHand, lastPlayed);
        
        if (move === 'pass') {
          // Bot passes
          gameLogger.info(`🤖 [Bot Coordinator] Bot ${gameState.currentTurn} passing`);
          
          await supabase.rpc('pass_turn', {
            p_room_id: roomId,
          });
        } else {
          // Bot plays cards
          const cardIds = move.map(card => card.id);
          const comboType = determineComboType(move);
          
          gameLogger.info(`🤖 [Bot Coordinator] Bot ${gameState.currentTurn} playing ${comboType}: ${cardIds.join(', ')}`);
          
          await supabase.rpc('play_cards', {
            p_room_id: roomId,
            p_card_ids: cardIds,
            p_combo_type: comboType,
          });
        }
        
        // Add delay before next bot turn (natural pacing)
        await new Promise(resolve => setTimeout(resolve, 1500));
        
      } catch (error) {
        gameLogger.error(`❌ [Bot Coordinator] Error executing bot turn:`, error);
      } finally {
        processingTurn.current = false;
      }
    };
    
    // Delay bot turn to feel natural (0.5-1s)
    const timeout = setTimeout(() => {
      executeBotTurn();
    }, 500 + Math.random() * 500);
    
    return () => clearTimeout(timeout);
    
  }, [gameState?.currentTurn, isCoordinator, enabled, roomId]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      botAICache.current.clear();
    };
  }, []);
}
```

---

### 1.3 Integrate Bot Coordinator with GameScreen

**File:** `apps/mobile/src/screens/GameScreen.tsx` (MODIFY)

**Changes:**
- Detect game mode (local vs multiplayer)
- Import and use `useBotCoordinator` for multiplayer games
- Keep `useGameStateManager` for local games

```typescript
// Add imports
import { useBotCoordinator } from '../hooks/useBotCoordinator';

// Inside GameScreenContent component
function GameScreenContent() {
  const route = useRoute<GameScreenRouteProp>();
  const { roomCode } = route.params;
  const { user, profile } = useAuth();
  
  // Detect game mode
  const isLocalGame = roomCode === 'LOCAL_AI_GAME' || roomCode === 'OFFLINE_MODE';
  const isMultiplayerGame = !isLocalGame;
  
  // Local game state (solo + 3 AI bots)
  const localGameState = useGameStateManager({
    roomCode,
    currentPlayerName: profile?.username || 'Player',
    addScoreHistory,
    openGameEndModal,
    scoreHistory,
    playHistoryByMatch,
    checkAndExecuteBotTurn,
    enabled: isLocalGame, // Only run for local games
  });
  
  // Multiplayer game state (humans + bots, server-side)
  const multiplayerGameState = useRealtime({
    userId: user?.id || '',
    username: profile?.username || 'Player',
    roomCode,
    enabled: isMultiplayerGame, // Only run for multiplayer
  });
  
  // Bot coordinator (only for multiplayer, only for coordinator)
  const [isCoordinator, setIsCoordinator] = useState(false);
  
  useEffect(() => {
    if (isMultiplayerGame && multiplayerGameState.room) {
      const coordinatorCheck = multiplayerGameState.room.bot_coordinator_id === user?.id;
      setIsCoordinator(coordinatorCheck);
    }
  }, [isMultiplayerGame, multiplayerGameState.room, user?.id]);
  
  useBotCoordinator({
    roomId: multiplayerGameState.room?.id || '',
    isCoordinator,
    gameState: multiplayerGameState.gameState,
    enabled: isMultiplayerGame && isCoordinator,
  });
  
  // Use appropriate game state
  const gameState = isLocalGame ? localGameState.gameState : multiplayerGameState.gameState;
  const isInitializing = isLocalGame ? localGameState.isInitializing : multiplayerGameState.isLoading;
  
  // Rest of component logic...
}
```

---

### 1.4 Testing Checklist (Phase 1)

- [ ] Database migration applies successfully
- [ ] Room codes exclude 1, I, 0, O
- [ ] Room code generation handles collisions
- [ ] Cleanup function deletes abandoned rooms
- [ ] `start_game_with_bots` creates bot players
- [ ] `start_game_with_bots` sets bot coordinator
- [ ] Bot coordinator hook runs only for coordinator
- [ ] Bot AI calculates moves correctly
- [ ] Bot moves broadcast via RPC
- [ ] All clients see bot moves via Realtime
- [ ] 2 humans + 2 bots game works end-to-end
- [ ] 3 humans + 1 bot game works end-to-end
- [ ] Ranked mode prevents bots at start
- [ ] Bot replacement works after 60s disconnect

**Success Criteria:** All combinations of humans + bots work in multiplayer.

---

## Phase 2: Unified Game Lobby (Week 2-3)

### 2.1 Lobby Screen Refactor

**Objective:** Create single lobby screen that handles all game types:
- Private rooms (create & join)
- Casual matchmaking rooms
- Ranked matchmaking rooms

**Decision Point:** If LobbyScreen.tsx exceeds 800 lines, split into:
- `LobbyScreen.tsx` - Private rooms
- `CasualWaitingRoomScreen.tsx` - Casual matchmaking
- `RankedWaitingRoomScreen.tsx` - Ranked matchmaking

#### A. Unified Lobby Features

**File:** `apps/mobile/src/screens/LobbyScreen.tsx` (MAJOR REFACTOR)

**New Features:**
1. **Room Type Detection**
   ```typescript
   interface RoomType {
     isPrivate: boolean;
     isCasual: boolean;
     isRanked: boolean;
   }
   
   const roomType: RoomType = {
     isPrivate: !room.is_matchmaking && !room.is_public,
     isCasual: room.is_matchmaking && !room.ranked_mode,
     isRanked: room.is_matchmaking && room.ranked_mode,
   };
   ```

2. **Ready System UI**
   ```typescript
   // Player cards show ready status
   <PlayerCard>
     <Text>{player.username}</Text>
     {player.is_ready ? (
       <CheckIcon color="green" />
     ) : (
       <Text>Waiting...</Text>
     )}
   </PlayerCard>
   
   // Ready button for current user
   {!isReady && (
     <TouchableOpacity onPress={handleToggleReady}>
       <Text>Ready</Text>
     </TouchableOpacity>
   )}
   ```

3. **Bot Filling Controls (Casual/Private Only)**
   ```typescript
   {!roomType.isRanked && isHost && (
     <View>
       <Text>Players: {humanCount}/4</Text>
       <Text>Bots needed: {4 - humanCount}</Text>
       
       {humanCount < 4 && (
         <TouchableOpacity onPress={handleStartWithBots}>
           <Text>Start with {4 - humanCount} AI Bot(s)</Text>
         </TouchableOpacity>
       )}
     </View>
   )}
   ```

4. **Auto-Start on All Ready**
   ```typescript
   useEffect(() => {
     // Subscribe to ready notifications
     const channel = supabase.channel(`room_ready_${roomId}`);
     
     channel.on('postgres_changes', {
       event: 'UPDATE',
       schema: 'public',
       table: 'room_players',
       filter: `room_id=eq.${roomId}`,
     }, (payload) => {
       checkAllReady();
     });
     
     channel.subscribe();
     
     return () => {
       channel.unsubscribe();
     };
   }, [roomId]);
   
   const checkAllReady = async () => {
     const { data: players } = await supabase
       .from('room_players')
       .select('is_ready')
       .eq('room_id', roomId);
     
     const allReady = players?.every(p => p.is_ready) && players.length === 4;
     
     if (allReady && isHost) {
       // Auto-start game
       await startGame();
     }
   };
   ```

5. **Room Code Display (All Types)**
   ```typescript
   <View style={styles.roomCodeCard}>
     <Text>Room Code</Text>
     <Text style={styles.roomCode}>{roomCode}</Text>
     <TouchableOpacity onPress={handleCopyCode}>
       <Text>Copy</Text>
     </TouchableOpacity>
     <TouchableOpacity onPress={handleShareCode}>
       <Text>Share</Text>
     </TouchableOpacity>
   </View>
   ```

6. **Host Badge & Controls**
   ```typescript
   <PlayerCard>
     {player.is_host && (
       <View style={styles.hostBadge}>
         <Text>HOST</Text>
       </View>
     )}
     <Text>{player.username}</Text>
   </PlayerCard>
   ```

#### B. Start Game Logic

```typescript
const handleStartWithBots = async () => {
  try {
    setIsStarting(true);
    
    const humanCount = players.filter(p => !p.is_bot).length;
    const botsNeeded = 4 - humanCount;
    
    if (botsNeeded < 0 || botsNeeded > 3) {
      throw new Error('Invalid player count');
    }
    
    if (roomType.isRanked && botsNeeded > 0) {
      throw new Error('Ranked games cannot start with bots');
    }
    
    if (humanCount === 1 && botsNeeded === 3) {
      // Solo game - use local engine
      navigation.replace('Game', { roomCode: 'LOCAL_AI_GAME' });
      return;
    }
    
    // Multiplayer game with bots
    const { data, error } = await supabase.rpc('start_game_with_bots', {
      p_room_id: roomId,
      p_bot_count: botsNeeded,
      p_bot_difficulty: 'medium',
    });
    
    if (error) throw error;
    
    // Navigate to game
    navigation.replace('Game', { roomCode });
    
  } catch (error) {
    showError(error.message);
  } finally {
    setIsStarting(false);
  }
};

const handleToggleReady = async () => {
  try {
    const { error } = await supabase
      .from('room_players')
      .update({ is_ready: !isReady })
      .eq('room_id', roomId)
      .eq('user_id', user.id);
    
    if (error) throw error;
    
    setIsReady(!isReady);
  } catch (error) {
    showError('Failed to update ready status');
  }
};
```

---

### 2.2 Remove Quick Play, Update Find Game

**File:** `apps/mobile/src/screens/HomeScreen.tsx` (MODIFY)

**Changes:**
1. Remove "Quick Play" button
2. Update "Find a Game" to show modal with options:
   - Casual Match (find any players, can start with bots)
   - Ranked Match (competitive, no bots at start)

```typescript
const [findGameModalVisible, setFindGameModalVisible] = useState(false);

// Replace Quick Play button with Find a Game
<TouchableOpacity onPress={() => setFindGameModalVisible(true)}>
  <Text>Find a Game</Text>
</TouchableOpacity>

// Modal
<Modal visible={findGameModalVisible}>
  <View>
    <Text>Find a Game</Text>
    
    <TouchableOpacity onPress={handleFindCasual}>
      <Text>Casual Match</Text>
      <Text>Play with anyone, start with AI if needed</Text>
    </TouchableOpacity>
    
    <TouchableOpacity onPress={handleFindRanked}>
      <Text>Ranked Match</Text>
      <Text>Competitive, 4 human players only</Text>
    </TouchableOpacity>
    
    <TouchableOpacity onPress={() => setFindGameModalVisible(false)}>
      <Text>Cancel</Text>
    </TouchableOpacity>
  </View>
</Modal>
```

---

### 2.3 Smart Routing

**File:** `apps/mobile/src/screens/JoinRoomScreen.tsx` (MODIFY)

```typescript
const handleJoinRoom = async () => {
  try {
    // Join room
    const { data, error } = await supabase.rpc('join_room_atomic', {
      p_room_code: roomCode.toUpperCase(),
      p_user_id: user.id,
      p_username: profile.username || 'Player',
    });
    
    if (error) throw error;
    
    // Get room details for routing
    const { data: roomData } = await supabase
      .from('rooms')
      .select('is_matchmaking, ranked_mode')
      .eq('code', roomCode.toUpperCase())
      .single();
    
    // Route to appropriate lobby
    // All rooms use same LobbyScreen (unified)
    navigation.replace('Lobby', { 
      roomCode: roomCode.toUpperCase(),
      roomType: {
        isPrivate: !roomData.is_matchmaking,
        isCasual: roomData.is_matchmaking && !roomData.ranked_mode,
        isRanked: roomData.is_matchmaking && roomData.ranked_mode,
      },
    });
    
  } catch (error) {
    showError(error.message);
  }
};
```

---

### 2.4 Testing Checklist (Phase 2)

- [ ] Unified lobby displays correctly for all room types
- [ ] Ready system shows real-time updates
- [ ] Ready button toggles correctly
- [ ] All players ready → auto-start game
- [ ] Host badge displays correctly
- [ ] Host controls visible only to host
- [ ] Room code displayed and copyable
- [ ] "Start with Bots" button hidden in ranked mode
- [ ] "Start with Bots" button shows correct bot count
- [ ] Quick Play button removed from home
- [ ] Find a Game modal shows casual/ranked options
- [ ] Joining room routes to correct lobby
- [ ] Private rooms → unified lobby (private mode)
- [ ] Casual rooms → unified lobby (casual mode)
- [ ] Ranked rooms → unified lobby (ranked mode)

**Success Criteria:** Single lobby works for all game types with correct behavior for each mode.

---

## Phase 3: Offline Practice Mode (Week 3)

### 3.1 Home Screen Offline Button

**File:** `apps/mobile/src/screens/HomeScreen.tsx` (MODIFY)

```typescript
// Add offline practice button
<TouchableOpacity 
  onPress={handleOfflinePractice}
  style={styles.offlineButton}
>
  <Text>Practice Offline</Text>
  <Text style={styles.subtitle}>Solo + 3 AI Bots (No Internet Required)</Text>
</TouchableOpacity>

const handleOfflinePractice = () => {
  // No auth check, no room creation, just navigate
  navigation.navigate('Game', { roomCode: 'OFFLINE_MODE' });
};
```

---

### 3.2 Offline Mode Detection in GameScreen

**File:** `apps/mobile/src/screens/GameScreen.tsx` (MODIFY)

```typescript
function GameScreenContent() {
  const route = useRoute<GameScreenRouteProp>();
  const { roomCode } = route.params;
  
  // Detect offline mode
  const isOfflineMode = roomCode === 'OFFLINE_MODE';
  const isLocalGame = roomCode === 'LOCAL_AI_GAME' || isOfflineMode;
  
  // Skip auth for offline mode
  const { user, profile } = useAuth();
  const currentPlayerName = isOfflineMode 
    ? 'You' 
    : (profile?.username || user?.email?.split('@')[0] || 'Player');
  
  // Use GameStateManager for offline (no Supabase calls)
  const { gameState, isInitializing } = useGameStateManager({
    roomCode: isOfflineMode ? 'offline_practice' : roomCode,
    currentPlayerName,
    addScoreHistory,
    openGameEndModal,
    scoreHistory,
    playHistoryByMatch,
    checkAndExecuteBotTurn,
    enabled: isLocalGame,
    offlineMode: isOfflineMode, // New prop
  });
  
  // Rest of component...
}
```

---

### 3.3 Update useGameStateManager for Offline Support

**File:** `apps/mobile/src/hooks/useGameStateManager.ts` (MODIFY)

```typescript
interface UseGameStateManagerProps {
  roomCode: string;
  currentPlayerName: string;
  addScoreHistory: (history: ScoreHistory) => void;
  openGameEndModal: (...args) => void;
  scoreHistory: ScoreHistory[];
  playHistoryByMatch: PlayHistoryMatch[];
  checkAndExecuteBotTurn: () => void;
  enabled: boolean;
  offlineMode?: boolean; // NEW
}

export function useGameStateManager(props: UseGameStateManagerProps) {
  const { offlineMode = false } = props;
  
  useEffect(() => {
    // Initialize game
    const initGame = async () => {
      // Skip Supabase operations in offline mode
      if (offlineMode) {
        gameLogger.info('🔌 [Offline Mode] Initializing without Supabase');
      }
      
      // Create game manager
      const manager = createGameStateManager(
        offlineMode ? 'offline_practice' : props.roomCode
      );
      
      gameManagerRef.current = manager;
      
      // Try loading saved state (AsyncStorage works offline)
      const savedState = await manager.loadState();
      
      if (savedState) {
        gameLogger.info('📂 [Offline Mode] Loaded saved game');
        setGameState(savedState);
      } else {
        // Initialize new game
        const initialState = await manager.initializeGame({
          playerName: props.currentPlayerName,
          botCount: 3,
          botDifficulty: 'medium',
        });
        setGameState(initialState);
      }
      
      // Subscribe to state changes
      manager.subscribe((newState) => {
        setGameState(newState);
        
        // Save to AsyncStorage (works offline)
        manager.saveState(newState);
      });
      
      setIsInitializing(false);
    };
    
    initGame();
  }, [offlineMode]);
  
  // Rest of hook...
}
```

---

### 3.4 Offline Stats Persistence

**File:** `apps/mobile/src/hooks/useOfflineStats.ts` (NEW)

```typescript
import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface OfflineStats {
  gamesPlayed: number;
  gamesWon: number;
  totalScore: number;
  bestScore: number;
  winRate: number;
}

const STATS_KEY = 'offline_practice_stats';

export function useOfflineStats() {
  const [stats, setStats] = useState<OfflineStats>({
    gamesPlayed: 0,
    gamesWon: 0,
    totalScore: 0,
    bestScore: 0,
    winRate: 0,
  });
  
  // Load stats on mount
  useEffect(() => {
    loadStats();
  }, []);
  
  const loadStats = async () => {
    try {
      const saved = await AsyncStorage.getItem(STATS_KEY);
      if (saved) {
        setStats(JSON.parse(saved));
      }
    } catch (error) {
      console.error('Failed to load offline stats:', error);
    }
  };
  
  const updateStats = async (won: boolean, score: number) => {
    const newStats: OfflineStats = {
      gamesPlayed: stats.gamesPlayed + 1,
      gamesWon: stats.gamesWon + (won ? 1 : 0),
      totalScore: stats.totalScore + score,
      bestScore: Math.max(stats.bestScore, score),
      winRate: 0,
    };
    
    newStats.winRate = newStats.gamesWon / newStats.gamesPlayed;
    
    setStats(newStats);
    
    try {
      await AsyncStorage.setItem(STATS_KEY, JSON.stringify(newStats));
    } catch (error) {
      console.error('Failed to save offline stats:', error);
    }
  };
  
  const resetStats = async () => {
    const emptyStats: OfflineStats = {
      gamesPlayed: 0,
      gamesWon: 0,
      totalScore: 0,
      bestScore: 0,
      winRate: 0,
    };
    
    setStats(emptyStats);
    
    try {
      await AsyncStorage.setItem(STATS_KEY, JSON.stringify(emptyStats));
    } catch (error) {
      console.error('Failed to reset offline stats:', error);
    }
  };
  
  return { stats, updateStats, resetStats, loadStats };
}
```

---

### 3.5 Rejoin Banner on Home Screen

**File:** `apps/mobile/src/screens/HomeScreen.tsx` (MODIFY)

```typescript
function HomeScreen() {
  const [activeRoom, setActiveRoom] = useState<{ code: string; status: string } | null>(null);
  const { user } = useAuth();
  
  // Check for active room on mount
  useEffect(() => {
    checkActiveRoom();
  }, [user]);
  
  const checkActiveRoom = async () => {
    if (!user) return;
    
    try {
      // Check for active room in room_players
      const { data: roomPlayer } = await supabase
        .from('room_players')
        .select(`
          room_id,
          rooms (
            code,
            status
          )
        `)
        .eq('user_id', user.id)
        .in('rooms.status', ['waiting', 'playing'])
        .single();
      
      if (roomPlayer?.rooms) {
        setActiveRoom({
          code: roomPlayer.rooms.code,
          status: roomPlayer.rooms.status,
        });
      }
    } catch (error) {
      // No active room
      setActiveRoom(null);
    }
  };
  
  const handleRejoinRoom = () => {
    if (!activeRoom) return;
    
    if (activeRoom.status === 'waiting') {
      navigation.navigate('Lobby', { roomCode: activeRoom.code });
    } else if (activeRoom.status === 'playing') {
      navigation.navigate('Game', { roomCode: activeRoom.code });
    }
  };
  
  return (
    <View>
      {/* Rejoin Banner */}
      {activeRoom && (
        <View style={styles.rejoinBanner}>
          <Text>You have an active game!</Text>
          <Text>Room: {activeRoom.code}</Text>
          <Text>Status: {activeRoom.status}</Text>
          <TouchableOpacity onPress={handleRejoinRoom}>
            <Text>Rejoin Game</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLeaveActiveRoom}>
            <Text>Leave</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {/* Rest of home screen */}
    </View>
  );
}
```

---

### 3.6 Testing Checklist (Phase 3)

- [ ] "Practice Offline" button visible on home screen
- [ ] Offline mode starts without auth check
- [ ] Offline mode starts without network requests
- [ ] Game works in airplane mode
- [ ] AsyncStorage saves game state offline
- [ ] Offline stats track games, wins, scores
- [ ] Stats persist across app restarts
- [ ] Rejoin banner appears on home screen
- [ ] Rejoin banner shows correct room code
- [ ] Rejoin button navigates to correct screen (lobby vs game)
- [ ] Leave button removes player from room
- [ ] Banner disappears after leaving/completing game

**Success Criteria:** Full offline play with stats, rejoin works seamlessly.

---

## Phase 4: Final Polish & Production Readiness (Week 4)

### 4.1 Room Code Cleanup Automation

**File:** `apps/mobile/supabase/functions/cleanup_rooms/index.ts` (NEW)

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    // Call cleanup function
    const { error } = await supabase.rpc('cleanup_abandoned_rooms');
    
    if (error) throw error;
    
    return new Response(
      JSON.stringify({ success: true, message: 'Room cleanup completed' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
```

**Setup Cron Job:** (via Supabase Dashboard)
- Trigger: Every 6 hours
- Function: `cleanup_rooms`

---

### 4.2 Ranked Mode Disconnect Monitoring

**File:** `apps/mobile/src/hooks/useDisconnectMonitor.ts` (NEW)

```typescript
import { useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { AppState } from 'react-native';

interface UseDisconnectMonitorProps {
  roomId: string;
  playerIndex: number;
  isRankedMode: boolean;
  enabled: boolean;
}

export function useDisconnectMonitor({
  roomId,
  playerIndex,
  isRankedMode,
  enabled,
}: UseDisconnectMonitorProps) {
  const disconnectTimeRef = useRef<number | null>(null);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    if (!enabled || !isRankedMode) return;
    
    // Monitor app state changes
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        // User backgrounded app
        disconnectTimeRef.current = Date.now();
      } else if (state === 'active') {
        // User returned
        disconnectTimeRef.current = null;
      }
    });
    
    // Check disconnect duration every 10 seconds
    checkIntervalRef.current = setInterval(async () => {
      if (disconnectTimeRef.current) {
        const duration = Math.floor((Date.now() - disconnectTimeRef.current) / 1000);
        
        if (duration >= 60) {
          // Disconnected for 60+ seconds, replace with bot
          try {
            await supabase.rpc('replace_disconnected_with_bot', {
              p_room_id: roomId,
              p_player_index: playerIndex,
              p_disconnect_duration_seconds: 60,
            });
          } catch (error) {
            console.error('Failed to replace with bot:', error);
          }
        }
      }
    }, 10000); // Check every 10 seconds
    
    return () => {
      subscription.remove();
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [enabled, isRankedMode, roomId, playerIndex]);
}
```

---

### 4.3 Comprehensive Testing

#### Integration Tests
- [ ] Solo + 3 AI bots (local mode)
- [ ] 2 humans + 2 AI bots (multiplayer)
- [ ] 3 humans + 1 AI bot (multiplayer)
- [ ] 4 humans (multiplayer, no bots)
- [ ] Private room creation & joining
- [ ] Casual matchmaking with bot start
- [ ] Ranked matchmaking (no bots)
- [ ] Ready system in all modes
- [ ] Auto-start when all ready
- [ ] Host badge and controls
- [ ] Room code sharing
- [ ] Offline practice mode
- [ ] Rejoin from home banner
- [ ] Ranked disconnect → bot replacement
- [ ] Room code cleanup automation

#### Edge Cases
- [ ] 4 bots alone (should prevent)
- [ ] Starting ranked with bots (should prevent)
- [ ] Network loss during multiplayer
- [ ] App backgrounding during turn
- [ ] Rapid ready/unready toggling
- [ ] Multiple coordinators (should prevent)
- [ ] Room code collision handling
- [ ] Cleanup of old rooms

---

## Summary & Timeline

### Implementation Breakdown

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| **Phase 1** | Week 1-2 (10-15 hours) | Database migration, bot coordinator, hybrid engine working |
| **Phase 2** | Week 2-3 (12-18 hours) | Unified lobby, ready system, smart routing |
| **Phase 3** | Week 3 (6-10 hours) | Offline mode, rejoin banner, stats |
| **Phase 4** | Week 4 (8-12 hours) | Cleanup automation, testing, polish |
| **TOTAL** | 3-4 weeks (36-55 hours) | Production-ready multiplayer system |

### Success Metrics

✅ **All 9 Requirements Working:**
1. Solo + 3 AI bots (local)
2. 2 humans + 2 AI bots (multiplayer)
3. 3 humans + 1 AI bot (multiplayer)
4. 4 humans (multiplayer)
5. Casual "Start with AI" working
6. Host dynamics correct
7. Rejoin continues game
8. Routing correct (unified lobby)
9. Room code visible and shareable

✅ **New Features:**
- Offline practice mode
- Ready system (all modes)
- Rejoin banner on home
- Ranked mode with disconnect handling
- Production-ready room codes (no 1, I, 0, O)
- Automated room cleanup

✅ **Architecture:**
- Single unified game engine
- Bot coordinator for multiplayer
- Consistent UI across all modes
- Scalable database design

---

## Risk Mitigation

### Lesson from Failed Implementation (c6e9235)

**What Went Wrong:**
- Changed too many files at once (12 files, 2,127 lines)
- Broke core drag-and-drop functionality
- Claimed "100% complete" without device testing
- No incremental commits
- No isolated testing

**How We'll Avoid It:**

1. **Incremental Commits**
   - Commit after each sub-phase
   - Test each commit independently
   - Never bundle unrelated changes

2. **Device Testing Before Claiming Complete**
   - Test on 2-3 physical devices after each phase
   - Document test results in progress tracker
   - Block next phase until current phase tested

3. **Isolated Feature Testing**
   - Test bot coordinator alone (mock game state)
   - Test lobby UI alone (mock room data)
   - Test offline mode alone (airplane mode)

4. **Core Functionality Protection**
   - Test drag-and-drop after EVERY change
   - Test card playing after EVERY change
   - Test turn system after EVERY change
   - If ANY core feature breaks, STOP and fix

5. **Rollback Plan**
   - Branch naming: `feat/phase-1-bot-coordinator`, `feat/phase-2-lobby`, etc.
   - Each phase = separate branch
   - Merge to dev only after testing
   - Can revert individual phases without losing everything

---

## Next Steps

1. **Review this plan** - Confirm approach before implementation
2. **Create progress tracker** - Track completion of each task
3. **Add tasks to Vercel** - Sync with project management dashboard
4. **Start Phase 1** - Database migration & bot coordinator

---

**Project Manager ready to execute! Waiting for approval to begin Phase 1.** 🚀
