# Phase 4: Option A - Full Server-Authoritative Implementation

**Date:** December 10, 2025  
**Estimated Effort:** 15 hours  
**Security Level:** ⭐⭐⭐⭐⭐ Maximum  
**Status:** APPROVED - Ready to implement

---

## 🎯 Architecture Overview

### Current State (Security Risk)
```
Client 1 → Local game logic → Sync moves → Client 2
         ↓                                    ↓
     Local hand state                   Local hand state
```
**Problem:** Clients control game state, can be manipulated

### Target State (Server-Authoritative)
```
Client 1 → Request action → Edge Function → Database → Broadcast → All Clients
                                ↓
                         Validates + Updates
                         (Single source of truth)
```
**Benefit:** Server owns all state, impossible to cheat

---

## 📦 Implementation Phases (15 hours total)

### Phase 4A: Edge Functions (5 hours)

#### Task 1: Create `deal-cards` Edge Function (3h)
**File:** `/apps/mobile/supabase/functions/deal-cards/index.ts`

**Responsibilities:**
1. Shuffle 52-card deck
2. Deal 13 cards to each player
3. Store hands in `room_players.hand` (JSONB)
4. Determine starting player (3♦)
5. Update `game_state.current_turn` and `game_phase: 'playing'`

**Implementation:**
```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface Card {
  id: string;      // e.g., "3D", "AS", "2H"
  rank: string;    // '3'-'10', 'J', 'Q', 'K', 'A', '2'
  suit: string;    // 'D', 'C', 'H', 'S'
}

serve(async (req) => {
  try {
    // 1. Parse request
    const { room_id } = await req.json();
    
    // 2. Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // 3. Verify room exists and is ready
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, status')
      .eq('id', room_id)
      .single();
    
    if (roomError || room.status !== 'playing') {
      throw new Error('Room not ready to start game');
    }
    
    // 4. Get players (ordered by position)
    const { data: roomPlayers, error: playersError } = await supabase
      .from('room_players')
      .select('player_id, position')
      .eq('room_id', room_id)
      .order('position');
    
    if (playersError || roomPlayers.length < 2) {
      throw new Error('Not enough players');
    }
    
    // 5. Create and shuffle deck
    const deck = createDeck();
    shuffleDeck(deck);
    
    // 6. Deal cards (13 per player for 4 players)
    const cardsPerPlayer = Math.floor(52 / roomPlayers.length);
    const hands: Card[][] = [];
    
    for (let i = 0; i < roomPlayers.length; i++) {
      const hand = deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer);
      hands.push(hand);
    }
    
    // 7. Find player with 3♦ (starting player)
    let startingPlayerIndex = 0;
    for (let i = 0; i < hands.length; i++) {
      if (hands[i].some(card => card.id === '3D')) {
        startingPlayerIndex = i;
        break;
      }
    }
    
    // 8. Update each player's hand in database
    for (let i = 0; i < roomPlayers.length; i++) {
      const { error: handError } = await supabase
        .from('room_players')
        .update({ hand: hands[i] })
        .eq('room_id', room_id)
        .eq('player_id', roomPlayers[i].player_id);
      
      if (handError) throw handError;
    }
    
    // 9. Update game_state
    const { error: gameError } = await supabase
      .from('game_state')
      .update({
        game_phase: 'playing',
        current_turn: startingPlayerIndex,
      })
      .eq('room_id', room_id);
    
    if (gameError) throw gameError;
    
    // 10. Return success
    return new Response(
      JSON.stringify({ 
        success: true,
        starting_player: startingPlayerIndex,
        player_count: roomPlayers.length
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    );
    
  } catch (error) {
    console.error('Deal cards error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// Helper: Create 52-card deck
function createDeck(): Card[] {
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const suits = ['D', 'C', 'H', 'S']; // Diamonds, Clubs, Hearts, Spades
  const deck: Card[] = [];
  
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        id: `${rank}${suit}`,
        rank,
        suit
      });
    }
  }
  
  return deck;
}

// Helper: Fisher-Yates shuffle
function shuffleDeck(deck: Card[]): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}
```

**Tests:** `/apps/mobile/supabase/functions/deal-cards/test.ts`
- Test: Creates 52 unique cards
- Test: Shuffles deck randomly
- Test: Deals correct number of cards per player
- Test: Finds player with 3♦
- Test: Updates database correctly
- Test: Handles edge cases (2 players, 3 players, 4 players)

---

#### Task 2: Create `update-hand` Edge Function (2h)
**File:** `/apps/mobile/supabase/functions/update-hand/index.ts`

**Responsibilities:**
1. Remove played cards from player's hand
2. Update `room_players.hand`
3. Check for game end (hand empty)
4. Return updated hand and status

**Implementation:**
```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  try {
    const { room_id, player_id, cards_played } = await req.json();
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // 1. Fetch current hand
    const { data: playerData, error: fetchError } = await supabase
      .from('room_players')
      .select('hand')
      .eq('room_id', room_id)
      .eq('player_id', player_id)
      .single();
    
    if (fetchError) throw fetchError;
    
    // 2. Remove played cards
    const currentHand = playerData.hand || [];
    const newHand = currentHand.filter(
      (card: any) => !cards_played.some(
        (played: any) => played.id === card.id
      )
    );
    
    // 3. Update hand in database
    const { error: updateError } = await supabase
      .from('room_players')
      .update({ hand: newHand })
      .eq('room_id', room_id)
      .eq('player_id', player_id);
    
    if (updateError) throw updateError;
    
    // 4. Check if player won (empty hand)
    const gameEnded = newHand.length === 0;
    
    return new Response(
      JSON.stringify({
        success: true,
        new_hand: newHand,
        hand_count: newHand.length,
        game_ended: gameEnded
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    );
    
  } catch (error) {
    console.error('Update hand error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
```

---

### Phase 4B: Database Migration (1 hour)

#### Task 3: Apply Phase 2 Migration (1h)

**Prerequisites:**
1. Start Docker: `open -a Docker`
2. Start local Supabase: `cd apps/mobile && supabase start`

**Apply migration:**
```bash
cd apps/mobile
supabase db push --local  # Test locally first
supabase db push         # Push to production
```

**Verify:**
```sql
-- Check hand column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'room_players' AND column_name = 'hand';

-- Check index exists
SELECT indexname FROM pg_indexes 
WHERE tablename = 'room_players' AND indexname = 'idx_room_players_hand_count';

-- Check RLS policies
SELECT policyname, cmd, qual 
FROM pg_policies 
WHERE tablename = 'room_players';
```

---

### Phase 4C: Client Integration (6 hours)

#### Task 4: Update `startGame()` in useRealtime.ts (1.5h)

**Changes:**
```typescript
const startGame = useCallback(async (): Promise<void> => {
  if (!isHost || !room) return;
  
  // Check if all room players are ready
  const allReady = roomPlayers.every(p => p.is_ready);
  if (!allReady) {
    throw new Error('All players must be ready');
  }
  
  if (roomPlayers.length < 2) {
    throw new Error('Need at least 2 players to start');
  }
  
  try {
    // Update room status
    await supabase
      .from('rooms')
      .update({ status: 'playing' })
      .eq('id', room.id);
    
    // Create initial game state
    const { data: newGameState, error: gameError } = await supabase
      .from('game_state')
      .insert({
        room_id: room.id,
        current_turn: 0,
        turn_timer: 30,
        last_play: null,
        pass_count: 0,
        game_phase: 'dealing',
      })
      .select()
      .single();
    
    if (gameError) throw gameError;
    
    // ✅ NEW: Call deal-cards Edge Function
    const { data: dealResult, error: dealError } = await supabase.functions.invoke(
      'deal-cards',
      { body: { room_id: room.id } }
    );
    
    if (dealError || !dealResult.success) {
      throw new Error(dealResult?.error || 'Failed to deal cards');
    }
    
    // ✅ NEW: Fetch player's hand from database
    const { data: playerData, error: handError } = await supabase
      .from('room_players')
      .select('hand')
      .eq('room_id', room.id)
      .eq('player_id', user.id)
      .single();
    
    if (handError) throw handError;
    
    // ✅ NEW: Store hand in state
    setPlayerHand(playerData.hand || []);
    
    await broadcastMessage('game_started', { game_state: newGameState });
  } catch (err) {
    const error = err as Error;
    setError(error);
    onError?.(error);
    throw error;
  }
}, [isHost, room, roomPlayers, user, onError, broadcastMessage]);
```

---

#### Task 5: Update `playCards()` in useRealtime.ts (2h)

**Changes:**
```typescript
const playCards = useCallback(async (cards: Card[]) => {
  if (!user || !room) return;
  
  try {
    setIsProcessing(true);
    
    // 1. Validate with Edge Function (already implemented ✅)
    const { data: validationResult, error: validationError } = await supabase.functions.invoke(
      'validate-multiplayer-play',
      {
        body: {
          room_id: room.id,
          player_id: user.id,
          action: 'play',
          cards: cards.map(c => ({
            id: `${c.rank}${c.suit.charAt(0).toUpperCase()}`,
            rank: c.rank,
            suit: c.suit.charAt(0).toUpperCase(),
          })),
        },
      }
    );
    
    if (validationError || !validationResult?.valid) {
      throw new Error(validationResult?.error || 'Invalid play');
    }
    
    // 2. Determine combo type
    const playType = determineComboType(cards);
    
    // 3. Update game state (last_play, pass_count, current_turn)
    const { error: playError } = await supabase
      .from('rooms')
      .update({
        last_play: {
          player_id: user.id,
          cards: cards,
          play_type: playType,
        },
        pass_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', room.id);
    
    if (playError) throw playError;
    
    // ✅ NEW: Update hand via Edge Function
    const { data: handResult, error: handError } = await supabase.functions.invoke(
      'update-hand',
      {
        body: {
          room_id: room.id,
          player_id: user.id,
          cards_played: cards.map(c => ({
            id: `${c.rank}${c.suit.charAt(0).toUpperCase()}`,
          })),
        },
      }
    );
    
    if (handError || !handResult.success) {
      throw new Error(handResult?.error || 'Failed to update hand');
    }
    
    // ✅ NEW: Update local hand state
    setPlayerHand(handResult.new_hand);
    
    // ✅ NEW: Check if game ended
    if (handResult.game_ended) {
      await broadcastMessage('game_ended', { winner_id: user.id });
      // TODO: Navigate to game over screen
    }
    
    // Broadcast to other players
    await broadcastMessage('cards_played', {
      player_id: user.id,
      cards: cards,
      play_type: playType,
    });
    
    // Advance turn
    await advanceTurn();
    
  } catch (error) {
    console.error('Error playing cards:', error);
    setError(error as Error);
    throw error;
  } finally {
    setIsProcessing(false);
  }
}, [user, room, broadcastMessage, advanceTurn]);
```

---

#### Task 6: Add Hand State Management (1.5h)

**New state in useRealtime.ts:**
```typescript
// Add to state section
const [playerHand, setPlayerHand] = useState<Card[]>([]);
const [opponentHandCounts, setOpponentHandCounts] = useState<Map<string, number>>(new Map());

// Subscribe to hand updates (for displaying card counts)
useEffect(() => {
  if (!roomId) return;
  
  const channel = supabase
    .channel(`room:${roomId}:hands`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'room_players',
      filter: `room_id=eq.${roomId}`,
    }, (payload) => {
      const { player_id, hand_count } = payload.new;
      
      // Update opponent card counts (NOT their actual cards)
      if (player_id !== user?.id) {
        setOpponentHandCounts(prev => new Map(prev).set(player_id, hand_count));
      }
    })
    .subscribe();
  
  return () => { channel.unsubscribe(); };
}, [roomId, user]);

// Fetch initial hand on game start
useEffect(() => {
  if (!roomId || !user || !gameState || gameState.game_phase !== 'playing') return;
  
  const fetchHand = async () => {
    const { data, error } = await supabase
      .from('room_players')
      .select('hand')
      .eq('room_id', roomId)
      .eq('player_id', user.id)
      .single();
    
    if (!error && data) {
      setPlayerHand(data.hand || []);
    }
  };
  
  fetchHand();
}, [roomId, user, gameState?.game_phase]);

// Add to return object
return {
  // ... existing properties
  playerHand,
  opponentHandCounts,
  // ... rest
};
```

**Update UseRealtimeReturn type:**
```typescript
export interface UseRealtimeReturn {
  // ... existing properties
  playerHand: Card[];
  opponentHandCounts: Map<string, number>;
  // ... rest
}
```

---

#### Task 7: Create Multiplayer Game UI (1h)

**Option 1: Extend GameScreen.tsx**
Add multiplayer mode detection:
```typescript
const isMultiplayer = roomCode && roomCode !== 'local';

// If multiplayer, use useRealtime hook instead of GameStateManager
const {
  playerHand,
  opponentHandCounts,
  playCards: playCardsMultiplayer,
  pass: passMultiplayer,
  gameState: multiplayerGameState,
  // ...
} = useRealtime({
  userId: user.id,
  username: user.username,
  // ...
});

// Conditional rendering
const hand = isMultiplayer ? playerHand : gameState.players[0].hand;
const onPlayCards = isMultiplayer ? playCardsMultiplayer : playCardsLocal;
```

**Option 2: Create MultiplayerGameScreen.tsx**
Separate screen specifically for multiplayer games with cleaner separation.

**Recommendation:** Option 1 (extend existing screen) for faster implementation.

---

### Phase 4D: Testing (3 hours)

#### Task 8: Integration Testing (2h)

**Test Suite:** `/apps/mobile/supabase/functions/*/test.ts`

1. **deal-cards tests:**
   - ✅ Creates 52 unique cards
   - ✅ Shuffles deck (entropy check)
   - ✅ Deals 13 cards to 4 players
   - ✅ Finds player with 3♦
   - ✅ Updates all player hands
   - ✅ Sets game_phase to 'playing'

2. **update-hand tests:**
   - ✅ Removes played cards correctly
   - ✅ Updates database
   - ✅ Returns new hand
   - ✅ Detects game end (empty hand)

3. **Full flow test:**
   ```typescript
   test('Complete game flow', async () => {
     // 1. Create room
     const room = await createRoom(4);
     
     // 2. Deal cards
     const dealResult = await dealCards(room.id);
     expect(dealResult.success).toBe(true);
     
     // 3. Fetch player hands
     const hands = await fetchAllHands(room.id);
     expect(hands.length).toBe(4);
     expect(hands[0].length).toBe(13);
     
     // 4. Play cards
     const playResult = await playCards(room.id, hands[0][0]);
     expect(playResult.success).toBe(true);
     
     // 5. Verify hand updated
     const newHand = await fetchHand(room.id, player1);
     expect(newHand.length).toBe(12);
   });
   ```

---

#### Task 9: End-to-End Testing (1h)

**Manual Test Scenarios:**

1. **Happy Path:**
   - Create room with 4 players
   - Start game
   - Verify all players receive 13 cards
   - Verify player with 3♦ goes first
   - Play cards
   - Verify hand updates
   - Verify opponent card counts update

2. **Edge Cases:**
   - 2 players (26 cards each)
   - 3 players (17 cards, 1 leftover)
   - Network failure during dealing
   - Player disconnects mid-game

3. **Security Tests:**
   - Try to play cards not in hand (should fail)
   - Try to access other player's hand (RLS should block)
   - Try to modify hand directly (should fail)

---

## 📊 Implementation Timeline

| Task | Duration | Dependencies |
|------|----------|--------------|
| 1. deal-cards Edge Function | 3h | None |
| 2. update-hand Edge Function | 2h | Task 1 |
| 3. Apply migration | 1h | None (parallel) |
| 4. Update startGame() | 1.5h | Task 1, 3 |
| 5. Update playCards() | 2h | Task 2, 3 |
| 6. Hand state management | 1.5h | Task 4, 5 |
| 7. Multiplayer UI | 1h | Task 6 |
| 8. Integration testing | 2h | All above |
| 9. E2E testing | 1h | Task 8 |

**Total:** 15 hours

**Critical Path:** Task 1 → Task 2 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9

**Parallelizable:** Task 3 (migration) can run alongside Task 1

---

## 🚀 Deployment Checklist

- [ ] Local testing complete (all tests passing)
- [ ] Edge Functions deployed: `supabase functions deploy deal-cards update-hand`
- [ ] Migration applied: `supabase db push`
- [ ] Client code deployed
- [ ] Smoke test in production
- [ ] Monitor Edge Function logs
- [ ] Monitor database performance
- [ ] Rollback plan ready

---

## ✅ Success Criteria

**Functional:**
- ✅ Cards dealt server-side (cannot be manipulated)
- ✅ Hands stored in database (single source of truth)
- ✅ Validation works with real hand data
- ✅ Players see correct card counts for opponents
- ✅ Game ends when player's hand is empty

**Security:**
- ✅ RLS policies prevent players from seeing others' hands
- ✅ Only Edge Functions can update hands
- ✅ Client cannot manipulate server state
- ✅ All game logic validated server-side

**Performance:**
- ✅ Deal-cards latency < 500ms
- ✅ Update-hand latency < 200ms
- ✅ No race conditions
- ✅ Handles 100+ concurrent games

---

## 📝 Next Immediate Steps

1. **Start Docker + Supabase:**
   ```bash
   open -a Docker
   cd apps/mobile && supabase start
   ```

2. **Create deal-cards Edge Function:**
   ```bash
   supabase functions new deal-cards
   # Then implement code from Task 1
   ```

3. **Test locally:**
   ```bash
   supabase functions serve deal-cards
   # Test with curl or Postman
   ```

4. **Proceed through tasks 1-9 sequentially**

---

**Ready to begin! 🚀**

**Estimated Completion:** 15 hours (2 full days of focused work)
