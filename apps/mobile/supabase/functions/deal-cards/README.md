# Deal Cards Edge Function

Server-side card dealing for multiplayer Big Two games.

## Overview

This Edge Function handles the initial card distribution when a multiplayer game starts. It ensures fair dealing and prevents client-side manipulation.

## Responsibilities

1. **Create Deck**: Generate standard 52-card deck
2. **Shuffle**: Use crypto-secure randomness for fair shuffle
3. **Deal Cards**: Distribute cards evenly to all players
4. **Find Starting Player**: Locate player with 3♦ (Big Two rules)
5. **Store Hands**: Save to `room_players.hand` (server-side only)
6. **Update Game State**: Set phase to 'playing', assign first turn

## API

### Request

**Endpoint:** `POST /functions/v1/deal-cards`

**Body:**
```json
{
  "room_id": "uuid"
}
```

### Response

**Success (200):**
```json
{
  "success": true,
  "starting_player": 2,
  "player_count": 4,
  "cards_per_player": 13,
  "message": "Dealt 13 cards to 4 players. Player 2 starts (has 3♦)."
}
```

**Error (400/500):**
```json
{
  "success": false,
  "error": "Not enough players (found 1, need at least 2)"
}
```

## Usage

### From Client (useRealtime.ts)

```typescript
const startGame = async () => {
  // 1. Update room status
  await supabase.from('rooms').update({ status: 'playing' }).eq('id', roomId);
  
  // 2. Create game_state
  await supabase.from('game_state').insert({
    room_id: roomId,
    game_phase: 'dealing',
    // ...
  });
  
  // 3. Deal cards
  const { data, error } = await supabase.functions.invoke('deal-cards', {
    body: { room_id: roomId }
  });
  
  if (error || !data.success) {
    throw new Error(data?.error || 'Failed to deal cards');
  }
  
  // 4. Fetch player's hand
  const { data: playerData } = await supabase
    .from('room_players')
    .select('hand')
    .eq('room_id', roomId)
    .eq('player_id', userId)
    .single();
  
  setPlayerHand(playerData.hand);
};
```

## Card Distribution

| Players | Cards per Player | Leftover |
|---------|------------------|----------|
| 2       | 26               | 0        |
| 3       | 17               | 1        |
| 4       | 13               | 0        |

## Security

- **Service Role Key**: Bypasses RLS policies to update all hands
- **Server-Side Storage**: Hands stored in database, not sent to all clients
- **RLS Policies**: Players can only view their own hand
- **Crypto Randomness**: Uses `crypto.getRandomValues()` for shuffle

## Database Changes

### room_players.hand (JSONB)

**Before:**
```sql
hand: null
```

**After:**
```sql
hand: [
  { "id": "3D", "rank": "3", "suit": "D" },
  { "id": "5H", "rank": "5", "suit": "H" },
  // ... 11 more cards
]
```

### game_state

**Before:**
```sql
game_phase: 'dealing'
current_turn: 0
```

**After:**
```sql
game_phase: 'playing'
current_turn: 2  -- Player with 3♦
```

## Testing

### Run Unit Tests

```bash
cd apps/mobile
deno test --allow-env supabase/functions/deal-cards/test.ts
```

### Manual Test (Local)

```bash
# Start local Supabase
supabase start

# Serve function
supabase functions serve deal-cards --env-file .env.local

# Test with curl
curl -X POST http://localhost:54321/functions/v1/deal-cards \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"room_id": "your-room-uuid"}'
```

### Expected Output

```json
{
  "success": true,
  "starting_player": 1,
  "player_count": 4,
  "cards_per_player": 13,
  "message": "Dealt 13 cards to 4 players. Player 1 starts (has 3♦)."
}
```

## Error Handling

| Error | Status | Cause |
|-------|--------|-------|
| `room_id is required` | 400 | Missing room_id in request |
| `Room not found` | 500 | Invalid room_id |
| `Room not ready` | 500 | Room status not 'playing' |
| `Not enough players` | 500 | < 2 players in room |
| `Too many players` | 500 | > 4 players in room |
| `Failed to fetch players` | 500 | Database error |
| `Failed to update hand` | 500 | Database error |
| `Failed to update game_state` | 500 | Database error |

## Performance

- **Cold Start**: ~200-500ms (first invocation)
- **Warm Start**: ~50-150ms (subsequent invocations)
- **Database Writes**: 4 updates (one per player) + 1 game_state update
- **Total Latency**: Target < 500ms

## Deployment

```bash
# Deploy function
cd apps/mobile
supabase functions deploy deal-cards

# Verify deployment
supabase functions list
```

## Monitoring

### Check Logs

```bash
supabase functions logs deal-cards --limit 50
```

### Expected Log Output

```
[deal-cards] Dealing to 4 players
[deal-cards] Player 0 (uuid-1): 13 cards
[deal-cards] Player 1 (uuid-2): 13 cards
[deal-cards] Player 2 (uuid-3): 13 cards
[deal-cards] Player 3 (uuid-4): 13 cards
[deal-cards] Player 2 has 3♦ (starting player)
[deal-cards] All hands stored in database
[deal-cards] Game started - turn: 2
```

## Troubleshooting

### Issue: "Room not ready"

**Cause:** Room status not set to 'playing' before calling function

**Fix:**
```typescript
await supabase.from('rooms').update({ status: 'playing' }).eq('id', roomId);
// Then call deal-cards
```

### Issue: "Not enough players"

**Cause:** < 2 players in room_players table

**Fix:** Ensure all players join lobby before starting game

### Issue: "Failed to update hand"

**Cause:** Missing `hand` column or RLS policy blocking service role

**Fix:** Apply Phase 2 migration:
```bash
supabase db push
```

## Related Functions

- **validate-multiplayer-play**: Validates plays using hand data
- **update-hand**: Removes played cards from hand
- **complete-game**: Handles game end and scoring

## Big Two Rules Reference

- **Starting Player**: Player with 3 of Diamonds goes first
- **Card Ranking**: 3 (low) → 4 → 5 → ... → K → A → 2 (high)
- **Suit Ranking**: ♦ (low) → ♣ → ♥ → ♠ (high)

---

**Last Updated:** December 10, 2025  
**Version:** 1.0.0  
**Status:** Ready for testing
