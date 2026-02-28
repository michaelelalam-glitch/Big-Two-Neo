# Manual Test Scenarios — Post-Decomposition Verification

**Purpose:** Verify that the GameScreen.tsx and useRealtime.ts decomposition refactoring preserved all gameplay behavior. No gameplay logic was changed — only extracted into separate files.

**Files Affected:**
- `GameScreen.tsx`: 1,362 → 713 lines (10 hooks extracted)
- `useRealtime.ts`: 1,115 → 550 lines (2 modules + 1 hook extracted)

**Test Device:** iOS Simulator or physical device via Expo Go / EAS build

---

## Scenario 1: Local AI Game — Full Match

**Hooks exercised:** `useGameStateManager`, `useGameActions`, `useCardSelection`, `useBotTurnManager`, `useDerivedGameState`, `useHelperButtons`, `usePlayerDisplayData`, `useScoreboardMapping`, `usePlayHistoryTracking`, `useGameAudio`, `useOneCardLeftAlert`, `useGameEndCallbacks`

### Steps:
1. Launch app → tap **Play vs AI**
2. Select **4 players**, difficulty **Medium**, tap **Start**
3. Wait for cards to be dealt (match-start sound should play)

### Checks:
- [ ] Your hand appears at the bottom, sorted by rank
- [ ] Scoreboard shows 4 player names with 13 cards each
- [ ] Current turn indicator highlights the correct player (whoever has 3♦)
- [ ] If a bot has 3♦, they play first automatically within ~2s

### Play Cards:
4. Select 1+ cards by tapping them (cards rise when selected)
5. Tap **Play** button

### Checks:
- [ ] Selected cards animate to the center "last play" area
- [ ] Your hand count decreases on the scoreboard
- [ ] Combo type label appears (e.g., "Pair", "Straight")
- [ ] Turn passes to the next player

### Pass Turn:
6. When it's your turn and you can't beat the current play, tap **Pass**

### Checks:
- [ ] "Pass" label appears briefly
- [ ] Turn advances to next player
- [ ] Bots play or pass automatically

### Helper Buttons:
7. Tap **Sort** button → cards sort by rank
8. Tap **Smart Sort** → cards group by playable combos
9. Tap **Hint** → a valid play is auto-selected

### Checks:
- [ ] Sort reorders your hand visually
- [ ] Hint highlights valid cards (yellow glow or selection)
- [ ] Haptic feedback fires on each button tap

---

## Scenario 2: One-Card-Left Alert

**Hooks exercised:** `useOneCardLeftAlert`, `useGameAudio`

### Steps:
1. Continue playing until any player (you or a bot) has exactly 1 card

### Checks:
- [ ] Alert sound plays when a player reaches 1 card
- [ ] Haptic vibration fires
- [ ] Alert plays only ONCE per player (not repeatedly)
- [ ] If multiple players reach 1 card at different times, alert plays for each

---

## Scenario 3: Match End & Score Display

**Hooks exercised:** `useMatchEndHandler`, `useGameEndCallbacks`, `usePlayerTotalScores`, `usePlayerDisplayData`, `usePlayHistoryTracking`

### Steps:
1. Play until a player plays their last card

### Checks:
- [ ] Game End modal appears showing:
  - Winner name
  - Each player's remaining cards and penalty
  - Match scores
- [ ] "Play Again" button is visible
- [ ] "Return to Menu" button is visible

### Play Again:
2. Tap **Play Again**

### Checks:
- [ ] New match starts with fresh 13-card hands
- [ ] Cumulative scores update on the scoreboard
- [ ] Match number increments (shown on scoreboard)
- [ ] Play history from previous match is visible in scoreboard expansion

### Return to Menu:
3. After another match ends, tap **Return to Menu**

### Checks:
- [ ] Returns to main menu without crash
- [ ] No lingering game state (starting a new game should be fresh)

---

## Scenario 4: Orientation Toggle

**Hooks exercised:** `useOrientationManager`, `useAdaptiveLandscapeLayout`, `useGameCleanup`

### Steps:
1. Start a local AI game in portrait mode
2. Tap the **orientation toggle** button (if available) or rotate device

### Checks:
- [ ] Layout smoothly transitions to landscape
- [ ] Cards, scoreboard, and buttons reposition correctly
- [ ] Hand is still playable in landscape mode
- [ ] Toggling back to portrait works correctly
- [ ] Preference persists (re-entering game keeps last orientation)

---

## Scenario 5: Leave Game Mid-Match

**Hooks exercised:** `useGameCleanup`, `useGameActions.handleLeaveGame`

### Steps:
1. Start a local AI game and play a few turns
2. Tap the **back button** or swipe back

### Checks:
- [ ] Confirmation dialog appears ("Leave game?")
- [ ] Tapping "Cancel" returns to game (game state intact)
- [ ] Tapping "Leave" returns to menu
- [ ] Orientation unlocks (returns to portrait if applicable)
- [ ] No crash or orphaned state

---

## Scenario 6: Multiplayer — Room Creation & Joining

**Hooks exercised:** `useRoomLobby.createRoom`, `useRoomLobby.joinRoom`, `useRealtime`, `useConnectionManager`

### Prerequisites:
- Two devices or one device + Supabase dashboard
- Both logged in with different accounts

### Steps (Device A — Host):
1. Tap **Multiplayer** → **Create Room**
2. Share the 6-character room code

### Checks (Device A):
- [ ] Room code appears on screen (6 uppercase alphanumeric chars)
- [ ] Host appears in player list with "Host" badge
- [ ] Loading indicator shows briefly during room creation

### Steps (Device B — Joiner):
3. Tap **Multiplayer** → **Join Room** → enter room code

### Checks (Device B):
- [ ] Join succeeds without error
- [ ] Both players appear in the lobby player list
- [ ] "player_joined" broadcast is received (Host sees new player appear)

---

## Scenario 7: Multiplayer — Ready & Start Game

**Hooks exercised:** `useRoomLobby.setReady`, `useRoomLobby.startGame`, `useMultiplayerRoomLoader`

### Steps:
1. Both players tap **Ready**
2. Host taps **Start Game** (selects bot difficulty for empty slots)

### Checks:
- [ ] Ready status updates in real-time for both players
- [ ] Push notification fires when all players are ready (host gets notified)
- [ ] Game starts: cards are dealt, player with 3♦ goes first
- [ ] Bot players fill remaining slots (up to 4 total)
- [ ] Both devices show the same initial game state

---

## Scenario 8: Multiplayer — Playing Cards

**Hooks exercised:** `realtimeActions.executePlayCards`, `useGameActions`, `useBotCoordinator`, `useMultiplayerLayout`

### Steps:
1. When it's your turn, select cards and tap **Play**
2. Wait for other players/bots to take their turns

### Checks:
- [ ] Cards are validated server-side (Edge Function call succeeds)
- [ ] Your hand updates on your device
- [ ] Other players' devices show your play in the "last play" area
- [ ] Turn indicator moves to the correct next player
- [ ] Card counts update for all players on the scoreboard
- [ ] Combo type is displayed correctly

### Bot Turns (multiplayer):
- [ ] Bots play automatically (host coordinates via `useBotCoordinator`)
- [ ] Bot plays are visible to all players in real-time
- [ ] No duplicate bot actions

---

## Scenario 9: Multiplayer — Passing

**Hooks exercised:** `realtimeActions.executePass`, `useGameActions`

### Steps:
1. When you can't beat the current play, tap **Pass**

### Checks:
- [ ] Pass is validated server-side
- [ ] Turn advances to next player
- [ ] "Pass" indicator shows for your seat
- [ ] Other players see you passed
- [ ] If all other players pass (trick cleared), new trick starts

---

## Scenario 10: Multiplayer — Auto-Pass Timer

**Hooks exercised:** `useAutoPassTimer`, `useClockSync`, `useGameAudio`

### Steps:
1. Play the highest possible card in the current trick (e.g., 2♠ as a single)
2. Observe the auto-pass timer countdown

### Checks:
- [ ] Timer countdown appears (visual indicator)
- [ ] Progressive haptic vibrations as timer counts down
- [ ] When timer expires, remaining players auto-pass
- [ ] New trick starts with the winning player
- [ ] Timer syncs across all devices (uses server timestamps)

---

## Scenario 11: Multiplayer — Match End

**Hooks exercised:** `realtimeActions.executePlayCards` (match_ended broadcast), `useMatchEndHandler`, `useGameEndCallbacks`, `useMultiplayerPlayHistory`

### Steps:
1. Play until one player plays all their cards

### Checks:
- [ ] Match end modal appears on ALL devices
- [ ] Server-calculated scores are displayed
- [ ] Match scores are correct (remaining cards = penalty)
- [ ] Next match auto-starts after ~2 seconds
- [ ] New hands are dealt
- [ ] Cumulative scores update on scoreboard
- [ ] Play history from previous match appears in scoreboard

### Game Over (target score reached):
- [ ] "Game Over" screen appears with final winner
- [ ] Final scores are displayed
- [ ] Option to return to menu

---

## Scenario 12: Multiplayer — Leave Room

**Hooks exercised:** `useRoomLobby.leaveRoom`, `useGameCleanup`

### Steps:
1. In the lobby, tap **Leave Room** or navigate back
2. During a game, navigate back

### Checks:
- [ ] Player is removed from room on the server
- [ ] Other players see the player leave (player list updates)
- [ ] Channel subscription is cleaned up (no lingering connections)
- [ ] Orientation unlocks on navigation cleanup

---

## Scenario 13: Multiplayer — Reconnection

**Hooks exercised:** `useConnectionManager`, `useRealtime.reconnect`

### Steps:
1. During a multiplayer game, toggle airplane mode on briefly
2. Turn airplane mode off

### Checks:
- [ ] Reconnection attempts automatically
- [ ] Game state resyncs after reconnection
- [ ] No duplicate plays or state corruption
- [ ] Connection status indicator updates

---

## Scenario 14: Scoreboard Expansion & Animation

**Hooks exercised:** `useScoreboardAnimations`, `useScoreboardMapping`, `usePlayerDisplayData`

### Steps:
1. During a game (local or multiplayer), tap the scoreboard

### Checks:
- [ ] Scoreboard expands with smooth animation (60fps)
- [ ] Shows: player names, current scores, card counts
- [ ] Player order: You (bottom) → Right → Top → Left
- [ ] Tapping again collapses with smooth animation
- [ ] Match number is displayed
- [ ] Play history (if available) is visible when expanded

---

## Scenario 15: Multiplayer Layout & Seat Positions

**Hooks exercised:** `useMultiplayerLayout`, `usePlayerDisplayData`

### Steps:
1. Join a 4-player multiplayer game
2. Observe the table layout

### Checks:
- [ ] Your cards are always at the bottom
- [ ] Other players are positioned at Left, Top, Right (relative to you)
- [ ] Card counts are shown for other players' hands
- [ ] Last play area shows the most recent play with correct cards
- [ ] Player names appear above their respective positions

---

## Quick Smoke Test Checklist

For rapid verification that decomposition didn't break anything:

| # | Test | Expected Result | Pass? |
|---|------|-----------------|-------|
| 1 | Start local AI game | Cards dealt, scoreboard shows | |
| 2 | Play a valid card | Card moves to center, turn advances | |
| 3 | Pass your turn | Turn advances to next player | |
| 4 | Bot takes turn | Bot plays within ~2s | |
| 5 | Tap Sort button | Cards reorder | |
| 6 | Tap Hint button | Valid cards highlighted | |
| 7 | Play until match end | Score modal appears | |
| 8 | Tap Play Again | New match with cumulative scores | |
| 9 | Navigate back | Confirmation dialog, clean exit | |
| 10 | Create multiplayer room | Room code displayed | |
| 11 | Join room (2nd device) | Both players visible | |
| 12 | Start multiplayer game | Cards dealt on both devices | |
| 13 | Play cards (multiplayer) | Syncs across devices | |
| 14 | Pass (multiplayer) | Turn advances on all devices | |
| 15 | Match end (multiplayer) | Score modal on all devices | |

---

## Notes

- **Integration test failures** (17 tests): The `Critical Multiplayer Rules` and `Username Uniqueness` test suites require a live Supabase connection and are expected to fail locally.
- **All unit tests pass:** 866/866 tests pass after both refactoring commits.
- **TypeScript:** 0 errors across all files.
- **No logic changes:** All extracted code is identical to the original inline code. The only behavioral change is the `pass()` error message when `gameState` is null: `"Not your turn"` → `"Game state not loaded"` (more descriptive).
