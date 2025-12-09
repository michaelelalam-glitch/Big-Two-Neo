# Validate Multiplayer Play - Edge Function

Server-side validation for Big Two multiplayer games, enforcing the one-card-left rule.

## Purpose

This Edge Function validates player actions (play/pass) in multiplayer Big Two games to ensure fair play and prevent client-side manipulation. It specifically enforces the **one-card-left rule**:

- **When the next player has only 1 card left:**
  - Players can only play their **highest single card**
  - Players **cannot pass** if they can beat the current play
  - Multi-card plays (pairs, triples, 5-card combos) are allowed

## Architecture

```
Client → Edge Function (validate) → Database (update)
         ↓ Valid/Invalid
         Response to client
```

**Why Edge Function (not RPC):**
- TypeScript (same language as client)
- Testable with Deno
- Reusable validation logic
- Better error handling

## Request Format

**Endpoint:** `POST /functions/v1/validate-multiplayer-play`

**Headers:**
```json
{
  "Content-Type": "application/json",
  "Authorization": "Bearer <user-token>"
}
```

**Body:**
```typescript
{
  room_id: string;        // UUID of the room
  player_id: string;      // UUID of the player making the action
  action: 'play' | 'pass'; // Action type
  cards?: Card[];         // Required for 'play' action
}

interface Card {
  id: string;    // e.g., "3D", "AS"
  rank: string;  // '3'-'10', 'J', 'Q', 'K', 'A', '2'
  suit: string;  // 'D', 'C', 'H', 'S'
}
```

## Response Format

**Success (200):**
```typescript
{
  valid: true;
  next_player_hand_count?: number;
}
```

**Validation Failed (400):**
```typescript
{
  valid: false;
  error: string;                // Human-readable error message
  next_player_hand_count?: number; // 1 if rule active
}
```

**Error (404/500):**
```typescript
{
  valid: false;
  error: string;
}
```

## Validation Rules

### 1. One-Card-Left Rule (Next Player Has 1 Card)

#### Playing Cards
- **Single cards:** Must play the highest card in hand
- **Pairs/Triples:** No restriction (can play any valid pair/triple)
- **5-card combos:** No restriction (can play any valid combo)

#### Passing
- **Cannot pass** if player can beat the last play
- **Can pass** if player cannot beat the last play

### 2. Normal Gameplay (Next Player Has 2+ Cards)
- All standard Big Two rules apply
- No one-card-left restrictions

## Error Messages

| Error | Description |
|-------|-------------|
| `Missing required fields: ...` | Request missing room_id, player_id, or action |
| `Cards required for play action` | Play action without cards |
| `Room not found` | Invalid room_id |
| `Not your turn` | Player trying to play out of turn |
| `Player not found in room` | Player not part of the room |
| `Player has no cards` | Player's hand is empty |
| `Next player has 1 card! You must play your highest card: X` | Violation of highest card rule |
| `Next player has 1 card! You cannot pass when you can beat the play` | Violation of cannot-pass rule |

## Examples

### Example 1: Valid Play (Highest Card)
```json
// Player hand: [5♥, 7♦, 2♠]
// Next player: 1 card

Request:
{
  "room_id": "123e4567-e89b-12d3-a456-426614174000",
  "player_id": "789e4567-e89b-12d3-a456-426614174000",
  "action": "play",
  "cards": [{ "id": "2S", "rank": "2", "suit": "S" }]
}

Response (200):
{
  "valid": true,
  "next_player_hand_count": 1
}
```

### Example 2: Invalid Play (Not Highest Card)
```json
// Player hand: [5♥, 7♦, 2♠]
// Next player: 1 card

Request:
{
  "room_id": "123e4567-e89b-12d3-a456-426614174000",
  "player_id": "789e4567-e89b-12d3-a456-426614174000",
  "action": "play",
  "cards": [{ "id": "5H", "rank": "5", "suit": "H" }]
}

Response (400):
{
  "valid": false,
  "error": "Next player has 1 card! You must play your highest card: 2♠",
  "next_player_hand_count": 1
}
```

### Example 3: Invalid Pass (Can Beat)
```json
// Player hand: [2♠]
// Last play: 5♥
// Next player: 1 card

Request:
{
  "room_id": "123e4567-e89b-12d3-a456-426614174000",
  "player_id": "789e4567-e89b-12d3-a456-426614174000",
  "action": "pass"
}

Response (400):
{
  "valid": false,
  "error": "Next player has 1 card! You cannot pass when you can beat the play.",
  "next_player_hand_count": 1
}
```

### Example 4: Valid Pair Play (Next Player Has 1 Card)
```json
// Player hand: [7♥, 7♦, 2♠]
// Next player: 1 card

Request:
{
  "room_id": "123e4567-e89b-12d3-a456-426614174000",
  "player_id": "789e4567-e89b-12d3-a456-426614174000",
  "action": "play",
  "cards": [
    { "id": "7H", "rank": "7", "suit": "H" },
    { "id": "7D", "rank": "7", "suit": "D" }
  ]
}

Response (200):
{
  "valid": true,
  "next_player_hand_count": 1
}
```

## Testing

### Unit Tests
```bash
cd apps/mobile
supabase functions serve validate-multiplayer-play
deno test --allow-net supabase/functions/validate-multiplayer-play/test.ts
```

### Integration Tests
```bash
# 1. Start local Supabase
supabase start

# 2. Apply migrations
supabase db reset

# 3. Run integration tests
deno test --allow-net --allow-env supabase/functions/validate-multiplayer-play/integration.test.ts
```

## Deployment

```bash
cd apps/mobile
supabase functions deploy validate-multiplayer-play
```

**Environment Variables (auto-injected):**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Performance

**Target Metrics:**
- **p50 latency:** <100ms
- **p99 latency:** <300ms
- **Error rate:** <0.1%

**Optimization Strategies:**
1. Index on `room_players.hand_count` for fast lookups
2. Minimal database queries (single SELECT for room + players)
3. Early validation (reject invalid requests before DB lookup)
4. Efficient sorting algorithms for hand ranking

## Monitoring

**Check logs:**
```bash
supabase functions logs validate-multiplayer-play --tail
```

**Key metrics to monitor:**
- Invocation count (should match play/pass actions)
- Error rate (should be low, mostly 400s for invalid plays)
- Latency (should be <300ms)

**LangSmith Tracing:**
- Project: `beastmode-unified-1.2`
- Dashboard: https://smith.langchain.com/

## Security

**Authentication:**
- Requires valid user token in Authorization header
- Validates user is part of the room

**Authorization:**
- Players can only validate their own actions
- Uses service role key for database access (bypasses RLS)

**Data Privacy:**
- Players' hands are stored securely in database
- RLS policies prevent players from seeing other players' hands
- Only current player's hand is validated

## Dependencies

**External:**
- `jsr:@supabase/functions-js/edge-runtime.d.ts`
- `jsr:@supabase/supabase-js@2`

**Internal (adapted from client):**
- Card sorting logic (from `game-logic.ts`)
- Card beating logic (from `game-logic.ts`)
- Card classification (simplified for server)

## Database Schema

**Required columns (from Phase 2 migration):**
```sql
-- room_players table
ALTER TABLE room_players 
ADD COLUMN hand JSONB DEFAULT '[]'::jsonb,
ADD COLUMN hand_count INTEGER GENERATED ALWAYS AS (jsonb_array_length(hand)) STORED;

CREATE INDEX idx_room_players_hand_count ON room_players(hand_count);
```

## Related Files

- **Client Hook:** `/apps/mobile/src/hooks/useRealtime.ts` (calls this function)
- **Local Validation:** `/apps/mobile/src/game/state.ts` (solo games only)
- **Game Logic:** `/apps/mobile/src/game/engine/game-logic.ts` (shared logic)

## Changelog

### v1.0.0 (2025-01-09)
- Initial implementation
- One-card-left rule validation for singles
- Pass validation with beating logic
- Multi-card play support (pairs, triples, 5-card combos)
- Comprehensive error messages
- Performance optimizations

## Future Enhancements

- [ ] Validation history table (audit log)
- [ ] Rate limiting per player
- [ ] Advanced cheating detection
- [ ] WebSocket support for real-time validation
- [ ] Caching for frequently accessed rooms

## Support

**Issues:** Report in GitHub Issues with tag `edge-function`  
**Documentation:** See `/docs/TASK_ONE_CARD_LEFT_MULTIPLAYER_IMPLEMENTATION_PLAN.md`
