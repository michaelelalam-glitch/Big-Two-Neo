# Comprehensive Analytics & Training Data Overhaul

**Branch:** `feat/comprehensive-analytics-tracking`  
**Date:** July 2025  
**Scope:** Firebase Analytics, Sentry, Supabase

---

## 1. Bug Fix: avg_cards_left Accuracy

**File:** [`src/hooks/useGameStatsUploader.ts`](apps/mobile/src/hooks/useGameStatsUploader.ts)

- **Problem:** `avg_cards_left` stat only showed cards remaining in the final match, not the true average across all matches in a game.
- **Fix:** Now computes the average `cardsRemaining` across ALL matches from `scores_history` (per-player, per-match). Falls back to the final match hand size if `scores_history` is unavailable.

---

## 2. Expanded Analytics Event Types

**File:** [`src/services/analytics.ts`](apps/mobile/src/services/analytics.ts)

### New Event Names Added (~30 new events)

| Event Name | Category | Description |
|---|---|---|
| `screen_time` | Navigation | Time spent on each screen |
| `game_not_completed` | Game | Game abandoned with reason |
| `play_validation_error` | Game | Invalid play attempt with error type |
| `turn_duration` | Game | Time taken per turn |
| `chat_session_duration` | Feature | Time spent with chat drawer open |
| `camera_session_duration` | Feature | Camera on duration |
| `microphone_session_duration` | Feature | Mic on duration |
| `video_chat_session_duration` | Feature | Full video chat session length |
| `video_chat_permission_denied` | Feature | Permission denied for camera/mic |
| `hint_result_played` | Game | Player followed the hint suggestion |
| `hint_result_ignored` | Game | Player played different cards than hint |
| `hint_no_valid_play` | Game | Hint found no valid play (must pass) |
| `smart_sort_used` | Game | Smart sort button pressed |
| `reconnect_attempted` | Connection | Reconnection attempt started |
| `reconnect_succeeded` | Connection | Successful reconnection |
| `reconnect_failed` | Connection | Failed reconnection |
| `connection_status_changed` | Connection | Realtime channel status change |
| `player_replaced_by_bot` | Connection | Player replaced by bot (disconnect) |
| `heartbeat_backoff` | Connection | Heartbeat failure with backoff |
| `app_state_changed` | System | App foreground/background transition |
| `room_closed_while_away` | Connection | Room closed while app backgrounded |
| `orientation_session_duration` | Feature | Time in portrait vs landscape |
| `throwable_sent` | Social | Throwable sent (type tracked) |
| `throwable_received` | Social | Throwable received (type + sender) |
| `setting_changed` | Settings | Any setting toggle changed |
| `language_changed` | Settings | Language preference changed |
| `cache_cleared` | Settings | Cache cleared (keys removed count) |
| `delete_account_initiated` | Settings | Account deletion started |
| `play_method_used` | Game | Button vs drag play method |

### New Utility Functions

| Function | Description |
|---|---|
| `screenTimeStart(screenName)` | Start tracking time on a screen |
| `screenTimeEnd(screenName)` | End tracking and emit `screen_time` event |
| `setLastHintCards(cards)` | Store hint suggestion for follow-up tracking |
| `checkHintFollowed(playedCards)` | Compare played cards to hint, emit result |
| `turnTimeStart()` | Start tracking turn decision time |
| `turnTimeEnd()` | End tracking and emit `turn_duration` event |
| `featureDurationStart(feature)` | Generic duration start for any feature |
| `featureDurationEnd(feature, event)` | Generic duration end with event emission |

---

## 3. Instrumented Files

### [`src/hooks/useHelperButtons.ts`](apps/mobile/src/hooks/useHelperButtons.ts)
- **Sort:** Tracks `sort_used` event
- **Smart Sort:** Tracks `smart_sort_used` event
- **Hint:** Tracks `hint_used` with params (hand_size, hint_cards, combo_type, has_last_play, is_first_play), `hint_no_valid_play` when no valid play found. Stores hint cards via `setLastHintCards()` for follow-up tracking.
- All events include Sentry breadcrumbs.

### [`src/hooks/useGameActions.ts`](apps/mobile/src/hooks/useGameActions.ts)
- **Play Method:** All `card_play` events include `play_method: 'button'`. Drag plays tracked via `play_method_used` with `method: 'drag'`.
- **Validation Errors:** 5 error types tracked: `card_not_in_hand`, `invalid_combo`, `must_play_3d_first`, `cannot_beat_combo`, `cannot_pass_when_leading`.
- **Turn Time:** `turnTimeEnd()` called on every play/pass action.
- **Hint Follow-up:** `checkHintFollowed()` called after successful plays.
- **Game Not Completed:** `game_not_completed` tracked with `reason: 'player_left'` when player abandons.

### [`src/hooks/useConnectionManager.ts`](apps/mobile/src/hooks/useConnectionManager.ts)
- **Heartbeat Backoff:** Tracks `heartbeat_backoff` with `consecutive_failures` count.
- **Bot Replacement:** Tracks `player_replaced_by_bot` from both heartbeat and realtime detection.
- **Reconnection:** Tracks `reconnect_succeeded` / `reconnect_failed`.
- **Disconnect:** Tracks intentional disconnects.
- **App State:** Tracks `app_state_changed` with `from`/`to` states.
- **Connection Status:** Tracks `connection_status_changed` via realtime channel listener.
- All events include Sentry breadcrumbs.

### [`src/navigation/AppNavigator.tsx`](apps/mobile/src/navigation/AppNavigator.tsx)
- **Screen Time:** `screenTimeStart()` on navigation ready and route changes. `screenTimeEnd()` on leaving a screen.

### [`src/hooks/useVideoChat.ts`](apps/mobile/src/hooks/useVideoChat.ts)
- **Camera Duration:** `featureDurationStart/End('camera')` on enable/disable → emits `camera_session_duration`.
- **Mic Duration:** `featureDurationStart/End('mic')` on enable/disable → emits `microphone_session_duration`.
- **Video Chat Session:** `featureDurationStart/End('video_chat')` on connect/disconnect → emits `video_chat_session_duration`.
- Covers all paths: toggleVideoChat, toggleVoiceChat, toggleCamera, toggleMic, unexpected disconnect.

### [`src/components/game/ChatDrawer.tsx`](apps/mobile/src/components/game/ChatDrawer.tsx)
- **Chat Session Duration:** `featureDurationStart/End('chat')` on open/close → emits `chat_session_duration`.

### [`src/hooks/useOrientationManager.ts`](apps/mobile/src/hooks/useOrientationManager.ts)
- **Orientation Duration:** Tracks time in portrait vs landscape via `featureDurationStart/End`.
- **Previous Orientation:** `orientation_changed` event now includes `previous_orientation` param.

### [`src/components/game/ThrowablePicker.tsx`](apps/mobile/src/components/game/ThrowablePicker.tsx)
- **Throwable Sent:** Tracks `throwable_sent` with `throwable_type` (egg, smoke, confetti, cake).

### [`src/hooks/useThrowables.ts`](apps/mobile/src/hooks/useThrowables.ts)
- **Throwable Received:** Tracks `throwable_received` with `throwable_type` and `from_name` when local player is targeted.

### [`src/hooks/useTurnInactivityTimer.ts`](apps/mobile/src/hooks/useTurnInactivityTimer.ts)
- **Turn Time Start:** Calls `turnTimeStart()` when a new turn sequence begins for the local player.

### [`src/screens/SettingsScreen.tsx`](apps/mobile/src/screens/SettingsScreen.tsx)
- **Setting Changes:** `setting_changed` with setting name + enabled status for sound and vibration toggles.
- **Language Change:** `language_changed` with new and previous language.
- **Cache Clear:** `cache_cleared` with number of keys removed.
- **Account Deletion:** `delete_account_initiated` tracked before edge function call.

### [`src/services/sentry.ts`](apps/mobile/src/services/sentry.ts)
- **Translation Error Tagging:** `beforeSend` now tags events containing "Translation not found" or "i18n" with `category: 'translation'` and `level: 'warning'`.
- **Missing Translation Breadcrumbs:** New `reportMissingTranslation(key, language)` function adds Sentry breadcrumbs for missing i18n keys.

### [`src/i18n/index.ts`](apps/mobile/src/i18n/index.ts)
- **Missing Translation Reporting:** When a translation key is not found, calls `reportMissingTranslation()` to log a Sentry breadcrumb (lazy import to avoid circular deps).

---

## 4. Supabase: game_hands_training Table

**Project:** `dppybucldqufbqhwnkxu` (big2-mobile-backend)  
**Migration (authoritative):** [`supabase/migrations/20260718000002_create_game_hands_training.sql`](apps/mobile/supabase/migrations/20260718000002_create_game_hands_training.sql)  
_(Legacy path `apps/mobile/migrations/20260717000000_create_game_hands_training.sql` is historical only — use the Supabase migrations path above for all deployments.)_

### Schema (30 columns)

| Column | Type | Description |
|---|---|---|
| `id` | uuid (PK) | Auto-generated row ID |
| `room_id` | uuid | Supabase room UUID |
| `room_code` | varchar | Human-readable room code |
| `game_session_id` | uuid | Groups all plays in one game |
| `round_number` | integer | Round/match number within game |
| `play_sequence` | integer | Play order within the round |
| `player_index` | integer | Player seat (0-3) |
| `is_bot` | boolean | Whether this player is a bot |
| `player_hash` | varchar | Anonymized player ID for ML |
| `hand_before_play` | jsonb | Full hand before the play |
| `hand_size_before` | integer | Cards in hand before play |
| `cards_played` | jsonb | Cards played (or empty for pass) |
| `combo_type` | varchar | single, pair, triple, straight, etc. |
| `combo_key` | integer | Numeric strength of the combo |
| `last_play_before` | jsonb | Previous play on the table |
| `last_play_combo_type` | varchar | Type of the previous play |
| `is_first_play_of_round` | boolean | First play after all pass |
| `is_first_play_of_game` | boolean | Very first play (must have 3♦) |
| `passes_before_this_play` | integer | Consecutive passes before this |
| `opponent_hand_sizes` | jsonb | Array of other players' hand sizes |
| `total_cards_remaining` | integer | Total cards left in game |
| `won_trick` | boolean | Did this play win the trick? |
| `won_round` | boolean | Did this player win the round? |
| `won_game` | boolean | Did this player win the game? |
| `cards_remaining_after_play` | integer | Cards left after this play |
| `was_highest_possible` | boolean | Was this the strongest possible play? |
| `alternative_plays_available` | integer | Number of other valid plays |
| `risk_score` | numeric | Computed risk metric |
| `created_at` | timestamptz | Row insertion time |
| `game_ended_at` | timestamptz | When the game concluded |

### Indexes (6)

- `game_session_id` — Group plays by game
- `combo_type` — Filter by play type
- `is_bot` — Separate bot vs human plays
- `(won_trick, won_round, won_game)` — Outcome filtering
- `created_at` — Time-range queries
- `player_hash` — Per-player analysis

### RLS Policies

- `service_role_insert` — Edge functions can insert
- `service_role_select` — Edge functions can read for export

---

## 5. Summary of Changes

| Category | Count | Details |
|---|---|---|
| Files Modified | 14 | Hooks, components, services, navigation |
| New Firebase Events | ~30 | Screen time, game actions, connections, features |
| New Utility Functions | 8 | Duration tracking, hint follow-up, turn time |
| Supabase Tables Created | 1 | `game_hands_training` (30 cols, 6 indexes) |
| Bug Fixes | 1 | avg_cards_left accuracy |
| Sentry Enhancements | 2 | Translation tagging + missing key breadcrumbs |
