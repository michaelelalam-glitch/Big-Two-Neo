# Hybrid Game Architecture Implementation Plan
## December 23, 2025 - COMPREHENSIVE SOLUTION

**Status:** IN PROGRESS  
**Objective:** Enable humans + AI bots to play together in synchronized multiplayer games  
**Timeline:** Full implementation in phases

---

## Architecture Overview

### Current Problem
Two separate game engines:
- **GameStateManager** (client-side): Solo + 3 AI bots (AsyncStorage)
- **useRealtime** (server-side): 4 humans only (Supabase Realtime)

### Solution: Unified Hybrid System

**ONE game engine (server-side) with bot support:**

```
┌─────────────────────────────────────────────────────┐
│         SERVER-SIDE GAME STATE (Supabase)           │
│                                                      │
│  Room → Game State → Players (humans + bots)        │
│                                                      │
│  Player 1: Human (user_id: abc123)                  │
│  Player 2: Human (user_id: def456)                  │
│  Player 3: Bot (user_id: NULL, is_bot: true)        │
│  Player 4: Bot (user_id: NULL, is_bot: true)        │
└─────────────────────────────────────────────────────┘
           ↓ Realtime subscriptions ↓
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │ Client 1 │  │ Client 2 │  │ Client 3 │
    │ (Human)  │  │ (Human)  │  │ (Bot?)   │
    └──────────┘  └──────────┘  └──────────┘
         ↑
    HOST coordinates
    bot moves
```

**Key Principles:**
1. **Single Source of Truth:** Supabase game_state table
2. **Bot Coordination:** Host client runs bot AI, broadcasts moves
3. **Deterministic Bots:** All clients see same bot behavior (host controls)
4. **Seamless Migration:** Humans can join/leave, bots fill gaps

---

## Phase 1: Database Schema Extensions

### 1.1 Add Bot Support to Players Table

**File:** `apps/mobile/supabase/migrations/20251223000001_add_bot_support_to_multiplayer.sql`

```sql
-- Add is_bot flag to players table (game state)
ALTER TABLE players 
ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE;

-- Add bot_difficulty column
ALTER TABLE players
ADD COLUMN IF NOT EXISTS bot_difficulty VARCHAR(10) DEFAULT 'medium'
CHECK (bot_difficulty IN ('easy', 'medium', 'hard'));

-- Add bot_name column (Bot 1, Bot 2, etc.)
ALTER TABLE players
ADD COLUMN IF NOT EXISTS bot_name VARCHAR(50);

-- Index for bot queries
CREATE INDEX IF NOT EXISTS idx_players_is_bot ON players(room_id, is_bot);

-- Update RLS policies to allow bot player creation
-- (Bots have NULL user_id, so need special policy)
CREATE POLICY "Host can create bot players" ON players
  FOR INSERT 
  WITH CHECK (
    is_bot = TRUE 
    AND EXISTS (
      SELECT 1 FROM rooms 
      WHERE rooms.id = players.room_id 
      AND rooms.host_id = auth.uid()
    )
  );

-- Comment
COMMENT ON COLUMN players.is_bot IS 'Whether this player is an AI bot (NULL user_id)';
COMMENT ON COLUMN players.bot_difficulty IS 'AI difficulty level for bot players';
```

### 1.2 Add Bot Coordinator Flag to Rooms

```sql
-- Track which client is coordinating bots
ALTER TABLE rooms
ADD COLUMN IF NOT EXISTS bot_coordinator_id UUID REFERENCES auth.users(id);

COMMENT ON COLUMN rooms.bot_coordinator_id IS 'User ID of client coordinating bot moves (typically host)';
```

---

## Phase 2: Server-Side Game Bot Logic

### 2.1 Extend `start_game` Edge Function

**File:** `apps/mobile/supabase/functions/start_game/index.ts` (or create if missing)

```typescript
/**
 * Start game with mixed humans + bots
 * 
 * @param room_id - Room UUID
 * @param bot_count - Number of bots to add (0-3)
 * @param bot_difficulty - Difficulty level
 */

export async function startGame(
  room_id: string,
  bot_count: number = 0,
  bot_difficulty: 'easy' | 'medium' | 'hard' = 'medium'
) {
  // 1. Get room and existing players
  const { data: room } = await supabase
    .from('rooms')
    .select('*, room_players(*)')
    .eq('id', room_id)
    .single();
  
  const humanPlayers = room.room_players.filter(p => !p.is_bot);
  const playerCount = humanPlayers.length + bot_count;
  
  if (playerCount !== 4) {
    throw new Error('Must have exactly 4 players (humans + bots)');
  }
  
  // 2. Create bot players in room_players
  const botPlayers = [];
  for (let i = 0; i < bot_count; i++) {
    const botIndex = humanPlayers.length + i;
    botPlayers.push({
      room_id,
      user_id: null, // Bots have no user_id
      username: `Bot ${i + 1}`,
      player_index: botIndex,
      is_bot: true,
      is_ready: true,
      is_host: false,
    });
  }
  
  await supabase.from('room_players').insert(botPlayers);
  
  // 3. Initialize game state
  const deck = shuffleDeck();
  const hands = dealCards(deck); // 13 cards each
  
  // 4. Create player entries in `players` table (game state)
  const allPlayers = [...humanPlayers, ...botPlayers];
  const playerEntries = allPlayers.map((p, index) => ({
    room_id,
    player_name: p.username,
    player_index: p.player_index,
    is_bot: p.is_bot || false,
    bot_difficulty: p.is_bot ? bot_difficulty : null,
    cards: hands[index],
    card_order: hands[index].map((c, i) => i), // Default order
    score: 0,
  }));
  
  await supabase.from('players').insert(playerEntries);
  
  // 5. Create game state
  const gameState = {
    room_id,
    current_turn: findPlayerWith3OfDiamonds(playerEntries),
    last_play: null,
    game_phase: 'playing',
    consecutive_passes: 0,
  };
  
  await supabase.from('game_state').insert(gameState);
  
  // 6. Update room status
  await supabase
    .from('rooms')
    .update({ 
      status: 'playing',
      bot_coordinator_id: room.host_id, // Host coordinates bots
    })
    .eq('id', room_id);
  
  return { success: true, game_state: gameState };
}
```

---

## Phase 3: Client-Side Bot Coordination

### 3.1 Create `useBotCoordinator` Hook

**File:** `apps/mobile/src/hooks/useBotCoordinator.ts`

```typescript
import { useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { createBotAI } from '../game/bot';
import type { Card, ComboType } from '../game/types';

interface UseBotCoordinatorProps {
  roomId: string;
  isCoordinator: boolean; // Only host runs bot logic
  gameState: any; // Full game state from Realtime
}

/**
 * Coordinates bot moves for server-side multiplayer game
 * 
 * Design:
 * - Only HOST client runs this logic (isCoordinator = true)
 * - When it's a bot's turn, host calculates bot move
 * - Host broadcasts move via play_cards Edge Function
 * - All clients see the bot move via Realtime subscription
 */
export function useBotCoordinator({ 
  roomId, 
  isCoordinator, 
  gameState 
}: UseBotCoordinatorProps) {
  const botAICache = useRef(new Map());
  
  useEffect(() => {
    if (!isCoordinator || !gameState) return;
    
    const currentPlayer = gameState.players[gameState.current_turn];
    
    // Skip if not a bot's turn
    if (!currentPlayer?.is_bot) return;
    
    // Bot turn logic
    const executeBotTurn = async () => {
      // Get or create bot AI
      let botAI = botAICache.current.get(currentPlayer.player_index);
      if (!botAI) {
        botAI = createBotAI(currentPlayer.bot_difficulty || 'medium');
        botAICache.current.set(currentPlayer.player_index, botAI);
      }
      
      // Calculate bot move
      const botDecision = botAI.getPlay(
        currentPlayer.cards,
        gameState.last_play,
        gameState.game_phase === 'first_play'
      );
      
      if (botDecision.shouldPass) {
        // Bot passes
        await supabase.rpc('pass_turn', {
          p_room_id: roomId,
          p_player_index: currentPlayer.player_index,
        });
      } else {
        // Bot plays cards
        await supabase.rpc('play_cards', {
          p_room_id: roomId,
          p_player_index: currentPlayer.player_index,
          p_card_ids: botDecision.cards.map(c => c.id),
          p_combo_type: botDecision.comboType,
        });
      }
    };
    
    // Delay for UX (show bot "thinking")
    const timer = setTimeout(executeBotTurn, 1500);
    return () => clearTimeout(timer);
    
  }, [gameState?.current_turn, isCoordinator, roomId]);
}
```

---

## Phase 4: Update LobbyScreen Bot Filling

### 4.1 Fix `handleStartWithBots`

**File:** `apps/mobile/src/screens/LobbyScreen.tsx`

```typescript
const handleStartWithBots = async () => {
  // ... existing validation ...
  
  const humanCount = players.filter(p => !p.is_bot).length;
  const botsNeeded = 4 - humanCount;
  
  if (botsNeeded === 0) {
    // Room full, start with humans only
    showError('Room is full! Starting with all human players.');
    // Call start game without bots
    await startMultiplayerGame(currentRoomId, 0);
  } else if (botsNeeded === 4) {
    // Solo game - use client-side engine
    navigation.replace('Game', { roomCode: 'LOCAL_AI_GAME' });
  } else {
    // Mixed game - use server-side with bots
    await startMultiplayerGame(currentRoomId, botsNeeded);
    navigation.replace('Game', { roomCode });
  }
};

async function startMultiplayerGame(roomId: string, botCount: number) {
  const { error } = await supabase.rpc('start_game_with_bots', {
    p_room_id: roomId,
    p_bot_count: botCount,
    p_bot_difficulty: 'medium',
  });
  
  if (error) throw error;
}
```

---

## Phase 5: Casual Waiting Room UI

### 5.1 Create CasualWaitingRoomScreen

**File:** `apps/mobile/src/screens/CasualWaitingRoomScreen.tsx`

```typescript
/**
 * Dedicated UI for casual matchmaking waiting rooms
 * 
 * Features:
 * - Shows all waiting players (real-time)
 * - First player = host (sees "Start with AI Bots" button)
 * - Host transfer when first player leaves
 * - Room code prominently displayed for sharing
 * - Auto-starts when 4 players join
 */
export default function CasualWaitingRoomScreen() {
  const route = useRoute<CasualWaitingRoomRouteProp>();
  const { roomCode } = route.params;
  const { user } = useAuth();
  
  const [players, setPlayers] = useState<Player[]>([]);
  const [isHost, setIsHost] = useState(false);
  
  // Real-time subscription to room_players
  useEffect(() => {
    const channel = supabase
      .channel(`room:${roomCode}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'room_players',
        filter: `room_id=eq.${roomId}`,
      }, (payload) => {
        loadPlayers();
      })
      .subscribe();
    
    return () => { supabase.removeChannel(channel); };
  }, [roomCode]);
  
  // Auto-start when 4 players
  useEffect(() => {
    if (players.length === 4 && isHost) {
      handleStartWithBots(); // With 0 bots
    }
  }, [players.length, isHost]);
  
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>🎮 Finding Players...</Text>
      
      {/* Room Code Display */}
      <View style={styles.roomCodeCard}>
        <Text style={styles.roomCodeLabel}>Share this code:</Text>
        <Text style={styles.roomCodeLarge}>{roomCode}</Text>
        <TouchableOpacity onPress={copyRoomCode}>
          <Text style={styles.copyButton}>📋 Copy Code</Text>
        </TouchableOpacity>
      </View>
      
      {/* Player List */}
      <View style={styles.playerGrid}>
        {[0, 1, 2, 3].map(index => (
          <View key={index} style={styles.playerSlot}>
            {players[index] ? (
              <>
                <Text style={styles.playerName}>
                  {players[index].username}
                  {players[index].is_host && ' 👑'}
                  {players[index].user_id === user?.id && ' (You)'}
                </Text>
              </>
            ) : (
              <Text style={styles.emptySlot}>Waiting...</Text>
            )}
          </View>
        ))}
      </View>
      
      {/* Host Actions */}
      {isHost && (
        <>
          <Text style={styles.hostBadge}>👑 You're the Host</Text>
          <TouchableOpacity 
            style={styles.startButton}
            onPress={handleStartWithBots}
          >
            <Text style={styles.startButtonText}>
              🤖 Start with AI Bots ({4 - players.length} bots)
            </Text>
          </TouchableOpacity>
        </>
      )}
      
      {/* Cancel Button */}
      <TouchableOpacity style={styles.cancelButton} onPress={handleLeave}>
        <Text>Cancel Matchmaking</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
```

---

## Phase 6: Routing Logic

### 6.1 Update JoinRoomScreen Routing

```typescript
// JoinRoomScreen.tsx
const { data: roomData } = await supabase
  .from('rooms')
  .select('id, code, is_public, is_matchmaking')
  .eq('code', roomCode)
  .single();

if (roomData.is_matchmaking || roomData.is_public) {
  // Casual matchmaking room
  navigation.replace('CasualWaitingRoom', { roomCode });
} else {
  // Private room
  navigation.replace('Lobby', { roomCode });
}
```

### 6.2 Update MatchmakingScreen Flow

```typescript
// When match found
if (matchFound && roomCode) {
  // Go to casual waiting room (not private lobby)
  navigation.replace('CasualWaitingRoom', { roomCode });
}
```

---

## Phase 7: GameScreen Integration

### 7.1 Detect Game Mode

```typescript
// GameScreen.tsx
const route = useRoute<GameScreenRouteProp>();
const { roomCode } = route.params;

const isLocalAIGame = roomCode === 'LOCAL_AI_GAME';
const isMultiplayerGame = roomCode && roomCode !== 'LOCAL_AI_GAME';

if (isLocalAIGame) {
  // Use client-side GameStateManager (solo + 3 AI bots)
  const { gameState } = useGameStateManager({ 
    roomCode: 'local',
    currentPlayerName,
    // ... 
  });
} else if (isMultiplayerGame) {
  // Use server-side useRealtime (humans + bots)
  const { 
    gameState, 
    players, 
    playCards, 
    pass 
  } = useRealtime({ 
    roomCode, 
    userId, 
    username 
  });
  
  // Add bot coordinator
  const isHost = players.find(p => p.user_id === userId)?.is_host;
  useBotCoordinator({ 
    roomId: gameState?.room_id, 
    isCoordinator: isHost,
    gameState,
  });
}
```

---

## Implementation Checklist

### Phase 1: Database ✅
- [ ] Create migration file `20251223000001_add_bot_support_to_multiplayer.sql`
- [ ] Add `is_bot`, `bot_difficulty`, `bot_name` to `players` table
- [ ] Add `bot_coordinator_id` to `rooms` table
- [ ] Update RLS policies for bot creation
- [ ] Test migration on dev database

### Phase 2: Server-Side Functions
- [ ] Create/update `start_game_with_bots` Edge Function
- [ ] Implement bot player creation logic
- [ ] Implement game state initialization with mixed players
- [ ] Test Edge Function with Postman/curl

### Phase 3: Bot Coordination
- [ ] Create `useBotCoordinator.ts` hook
- [ ] Integrate bot AI logic from GameStateManager
- [ ] Add bot turn detection and execution
- [ ] Test bot moves in multiplayer context

### Phase 4: LobbyScreen Updates
- [ ] Fix `handleStartWithBots` to count humans
- [ ] Add bot-filling logic (4 - humanCount)
- [ ] Add solo game detection (humanCount === 1)
- [ ] Remove button when room full (4 humans)
- [ ] Test all combinations (1+3, 2+2, 3+1, 4+0)

### Phase 5: Casual Waiting Room
- [ ] Create `CasualWaitingRoomScreen.tsx`
- [ ] Implement real-time player subscription
- [ ] Add host badge and button visibility
- [ ] Add room code display and copy
- [ ] Add auto-start when 4 players join
- [ ] Test host transfer on leave

### Phase 6: Routing
- [ ] Update `JoinRoomScreen` conditional routing
- [ ] Update `MatchmakingScreen` navigation
- [ ] Update `HomeScreen` Quick Play flow
- [ ] Add `CasualWaitingRoom` to AppNavigator
- [ ] Test all navigation paths

### Phase 7: GameScreen
- [ ] Add game mode detection (local vs multiplayer)
- [ ] Integrate `useBotCoordinator` for multiplayer
- [ ] Keep `useGameStateManager` for local games
- [ ] Test both code paths
- [ ] Verify bot moves appear for all clients

### Phase 8: Testing
- [ ] Test Requirement 1: Solo + 3 AI bots
- [ ] Test Requirement 2: 2 humans + 2 AI bots
- [ ] Test Requirement 3: 3 humans + 1 AI bot
- [ ] Test Requirement 4: 4 humans, auto-start
- [ ] Test Requirement 5: Casual first player starts with AI
- [ ] Test Requirement 6: Host dynamics, host transfer
- [ ] Test Requirement 7: Rejoin continues game
- [ ] Test Requirement 8: Join routing (private/casual)
- [ ] Test Requirement 9: Room code visible and shareable

---

## Timeline

**Phase 1 (Database):** 1 hour  
**Phase 2 (Edge Functions):** 2-3 hours  
**Phase 3 (Bot Coordination):** 2 hours  
**Phase 4 (Lobby Updates):** 1 hour  
**Phase 5 (Casual Waiting Room):** 3 hours  
**Phase 6 (Routing):** 1 hour  
**Phase 7 (GameScreen):** 2 hours  
**Phase 8 (Testing):** 3 hours  

**Total:** ~15-16 hours (2 days with breaks)

---

## Success Criteria

✅ All 9 requirements working  
✅ Humans + AI bots play together seamlessly  
✅ Proper UI for private vs casual rooms  
✅ Host dynamics work correctly  
✅ No architecture excuses - FULL HYBRID SYSTEM

---

**Next Step:** Start Phase 1 implementation NOW.
