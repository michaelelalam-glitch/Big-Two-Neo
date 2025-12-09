# Update Hand Edge Function

Server-side hand updates after playing cards in multiplayer Big Two games.

## Overview

This Edge Function removes played cards from a player's hand after validation. It ensures hands stay in sync with game state and detects when a player wins.

## Responsibilities

1. **Fetch Current Hand**: Get player's hand from `room_players.hand`
2. **Validate Cards**: Ensure played cards exist in hand (anti-cheat)
3. **Remove Cards**: Filter out played cards from hand
4. **Update Database**: Save new hand to `room_players.hand`
5. **Detect Win**: Check if hand is empty (player won)
6. **Return Status**: Send updated hand and game status

## API

### Request

**Endpoint:** `POST /functions/v1/update-hand`

**Body:**
```json
{
  "room_id": "uuid",
  "player_id": "uuid",
  "cards_played": [
    { "id": "3D", "rank": "3", "suit": "D" },
    { "id": "3H", "rank": "3", "suit": "H" }
  ]
}
```

### Response

**Success (200):**
```json
{
  "success": true,
  "new_hand": [
    { "id": "5C", "rank": "5", "suit": "C" },
    { "id": "7H", "rank": "7", "suit": "H" }
    // ... remaining cards
  ],
  "hand_count": 11,
  "game_ended": false,
  "cards_removed": 2,
  "message": "Removed 2 cards. 11 cards remaining."
}
```

**Win (200):**
```json
{
  "success": true,
  "new_hand": [],
  "hand_count": 0,
  "game_ended": true,
  "cards_removed": 1,
  "message": "Player won! Hand is now empty."
}
```

**Error (400/500):**
```json
{
  "success": false,
  "error": "Card 2S not in player's hand (possible cheating attempt)"
}
```

## Usage

### From Client (useRealtime.ts)

```typescript
const playCards = async (cards: Card[]) => {
  // 1. Validate play (call validate-multiplayer-play)
  const validationResult = await supabase.functions.invoke(
    'validate-multiplayer-play',
    { body: { room_id, player_id, action: 'play', cards } }
  );
  
  if (!validationResult.data.valid) {
    throw new Error(validationResult.data.error);
  }
  
  // 2. Update game state (last_play, pass_count)
  await supabase.from('rooms').update({
    last_play: { player_id, cards, play_type },
    pass_count: 0
  }).eq('id', roomId);
  
  // 3. Update hand
  const { data, error } = await supabase.functions.invoke('update-hand', {
    body: {
      room_id: roomId,
      player_id: userId,
      cards_played: cards.map(c => ({ id: c.id }))
    }
  });
  
  if (error || !data.success) {
    throw new Error(data?.error || 'Failed to update hand');
  }
  
  // 4. Update local state
  setPlayerHand(data.new_hand);
  
  // 5. Check if game ended
  if (data.game_ended) {
    await broadcastMessage('game_ended', { winner_id: userId });
    // Navigate to game over screen
  }
};
```

## Security Features

### Anti-Cheat Validation

**Scenario:** Malicious client tries to remove cards not in hand

```typescript
// Client sends (CHEATING):
cards_played: [{ id: "2S" }]  // But player doesn't have 2♠

// Server validates:
if (!handCardIds.has("2S")) {
  throw new Error("Card 2S not in player's hand (possible cheating attempt)");
}
```

**Result:** ❌ Error returned, hand not updated

### Card Existence Check

```typescript
const playedCardIds = new Set(cards_played.map(c => c.id));
const handCardIds = new Set(currentHand.map(c => c.id));

for (const cardId of playedCardIds) {
  if (!handCardIds.has(cardId)) {
    throw new Error(`Card ${cardId} not in hand`);
  }
}
```

## Database Changes

### Before Play

```sql
-- room_players.hand
[
  { "id": "3D", "rank": "3", "suit": "D" },
  { "id": "5H", "rank": "5", "suit": "H" },
  { "id": "7C", "rank": "7", "suit": "C" }
]
-- hand_count: 3
```

### After Play (playing 3D)

```sql
-- room_players.hand
[
  { "id": "5H", "rank": "5", "suit": "H" },
  { "id": "7C", "rank": "7", "suit": "C" }
]
-- hand_count: 2 (auto-updated by generated column)
```

## Testing

### Run Unit Tests

```bash
cd apps/mobile
deno test --allow-env supabase/functions/update-hand/test.ts
```

### Manual Test (Local)

```bash
# Start function
supabase functions serve update-hand --env-file .env.local

# Test with curl
curl -X POST http://localhost:54321/functions/v1/update-hand \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "room_id": "your-room-uuid",
    "player_id": "your-player-uuid",
    "cards_played": [{"id": "3D", "rank": "3", "suit": "D"}]
  }'
```

## Error Handling

| Error | Status | Cause |
|-------|--------|-------|
| `room_id is required` | 400 | Missing room_id |
| `player_id is required` | 400 | Missing player_id |
| `cards_played must be non-empty array` | 400 | Invalid cards_played |
| `Player not found in room` | 500 | Invalid player_id or room_id |
| `Player has no cards to play` | 500 | Hand already empty |
| `Card X not in player's hand` | 500 | Cheating attempt detected |
| `Failed to fetch player hand` | 500 | Database error |
| `Failed to update hand` | 500 | Database error |

## Performance

- **Database Reads**: 1 (fetch current hand)
- **Database Writes**: 1 (update hand)
- **Latency**: Target < 200ms
- **Cold Start**: ~100-300ms
- **Warm Start**: ~30-100ms

## Call Sequence

```
playCards() in client
    ↓
validate-multiplayer-play (validation)
    ↓
Update rooms.last_play
    ↓
update-hand (remove cards)  ← THIS FUNCTION
    ↓
Update local client state
    ↓
Broadcast to other players
```

## Deployment

```bash
# Deploy function
cd apps/mobile
supabase functions deploy update-hand

# Verify
supabase functions list
```

## Monitoring

### Check Logs

```bash
supabase functions logs update-hand --limit 50
```

### Expected Log Output

```
[update-hand] Player uuid-1 - Current hand: 13 cards
[update-hand] Removing 2 cards: 3D, 3H
[update-hand] New hand: 11 cards
```

### Win Detection

```
[update-hand] Player uuid-1 - Current hand: 1 cards
[update-hand] Removing 1 cards: 2S
[update-hand] New hand: 0 cards
[update-hand] 🎉 Player uuid-1 wins! (empty hand)
```

## Troubleshooting

### Issue: "Card X not in player's hand"

**Cause:** Client sent cards that don't exist in server-side hand

**Common Scenarios:**
1. Desync between client and server state
2. Race condition (two plays at once)
3. Cheating attempt

**Fix:** Fetch hand from server before allowing play

### Issue: "Player has no cards to play"

**Cause:** Hand already empty (game already ended)

**Fix:** Check game status before allowing play

### Issue: "Failed to update hand"

**Cause:** Missing `hand` column or RLS policy issue

**Fix:** Apply Phase 2 migration

## Related Functions

- **validate-multiplayer-play**: Must be called BEFORE update-hand
- **deal-cards**: Creates initial hands
- **complete-game**: Handles scoring after update-hand detects win

## Integration with Validation

**Complete Flow:**
```typescript
// 1. Validate (checks one-card-left rule)
const validation = await invoke('validate-multiplayer-play', {
  room_id, player_id, action: 'play', cards
});

// 2. If valid, update game state
if (validation.valid) {
  await updateGameState(last_play, pass_count);
  
  // 3. Update hand (this function)
  const handUpdate = await invoke('update-hand', {
    room_id, player_id, cards_played: cards
  });
  
  // 4. Check win
  if (handUpdate.game_ended) {
    await endGame(player_id);
  }
}
```

---

**Last Updated:** December 10, 2025  
**Version:** 1.0.0  
**Status:** Ready for testing
