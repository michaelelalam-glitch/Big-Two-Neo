# Manual Testing Guide: Comprehensive Analytics Overhaul

**Branch:** `feat/comprehensive-analytics-tracking`  
**Prerequisites:**
- Development build (not Expo Go) for camera/mic/orientation features
- Firebase Analytics debug view enabled (`-FIRAnalyticsDebugEnabled` launch arg)
- Sentry dashboard access
- Supabase dashboard access (project: `dppybucldqufbqhwnkxu`)

---

## Test Setup

1. Enable Firebase Analytics debug view:
   - iOS: Edit scheme → Run → Arguments → Add `-FIRAnalyticsDebugEnabled`
   - Android: `adb shell setprop debug.firebase.analytics.app com.big2mobile`
2. Open Firebase Console → DebugView to see events in real time
3. Open Sentry dashboard → Issues to monitor breadcrumbs/events

---

## Test 1: Screen Time Tracking

| Step | Action | Expected Analytics Event |
|---|---|---|
| 1 | Open app → land on Home screen | `screen_view` for "Home" |
| 2 | Navigate to Settings | `screen_time` for "Home" (check `duration_seconds`), `screen_view` for "Settings" |
| 3 | Return to Home | `screen_time` for "Settings", `screen_view` for "Home" |
| 4 | Enter a multiplayer game | `screen_time` for "Home", `screen_view` for "Game" |

**Verify:** Each `screen_time` event has `screen_name` and `duration_seconds` > 0.

---

## Test 2: Sort & Hint Buttons

| Step | Action | Expected Analytics Event |
|---|---|---|
| 1 | Start a game (local AI or multiplayer) | — |
| 2 | Press Sort button | `sort_used` + Sentry breadcrumb |
| 3 | Press Smart Sort button | `smart_sort_used` + Sentry breadcrumb |
| 4 | Press Hint button (with valid plays) | `hint_used` with `hint_cards`, `combo_type`, `hand_size` |
| 5 | Play the exact cards hint suggested | `hint_result_played` |
| 6 | Press Hint, then play different cards | `hint_result_ignored` |
| 7 | Press Hint when no valid play exists | `hint_no_valid_play` |

---

## Test 3: Play Method Tracking (Button vs Drag)

| Step | Action | Expected Analytics Event |
|---|---|---|
| 1 | Select cards and press Play button | `card_play` with `play_method: 'button'` |
| 2 | Drag cards to play area | `play_method_used` with `method: 'drag'` |

---

## Test 4: Validation Error Tracking

| Step | Action | Expected Analytics Event |
|---|---|---|
| 1 | Try to play an invalid combo (e.g., random 4 cards) | `play_validation_error` with `error_type: 'invalid_combo'` |
| 2 | Try to pass when you must lead | `play_validation_error` with `error_type: 'cannot_pass_when_leading'` |
| 3 | First play without 3♦ | `play_validation_error` with `error_type: 'must_play_3d_first'` |
| 4 | Play a combo weaker than current | `play_validation_error` with `error_type: 'cannot_beat_combo'` |

---

## Test 5: Turn Time Tracking

| Step | Action | Expected Analytics Event |
|---|---|---|
| 1 | Wait for your turn to start | `turnTimeStart()` fires (no visible event yet) |
| 2 | Play cards or pass | `turn_duration` with `duration_seconds` |
| 3 | Take 15 seconds to decide, then play | Verify `duration_seconds` ≈ 15 |

---

## Test 6: Chat Session Duration

| Step | Action | Expected Analytics Event |
|---|---|---|
| 1 | Open chat drawer in multiplayer | `chat_opened` + `featureDurationStart('chat')` |
| 2 | Send a message | `chat_message_sent` with `message_length` |
| 3 | Close chat drawer after ~30s | `chat_closed` + `chat_session_duration` with `duration_seconds` ≈ 30 |

---

## Test 7: Camera / Mic / Voice Chat Duration

| Step | Action | Expected Analytics Event |
|---|---|---|
| 1 | Toggle video chat ON in multiplayer | `featureDurationStart` for video_chat + camera + mic |
| 2 | Wait ~20s, toggle video OFF | `camera_session_duration`, `microphone_session_duration`, `video_chat_session_duration` (≈ 20s each) |
| 3 | Toggle voice-only chat ON | `featureDurationStart` for video_chat + mic |
| 4 | Mute mic (toggle mic off) | `microphone_session_duration` |
| 5 | Unmute mic | New `featureDurationStart('mic')` |
| 6 | Toggle camera ON/OFF independently | `camera_session_duration` on disable |

**Also test:** Unexpected disconnect (kill network) → should emit all active duration events.

---

## Test 8: Connection Tracking

| Step | Action | Expected Analytics Event |
|---|---|---|
| 1 | Join multiplayer game normally | — |
| 2 | Toggle airplane mode for ~10s | `heartbeat_backoff` with `consecutive_failures` |
| 3 | Turn airplane mode off | `reconnect_succeeded` or `reconnect_failed` |
| 4 | Stay disconnected until bot replacement | `player_replaced_by_bot` |
| 5 | Background the app | `app_state_changed` with `from: 'active'`, `to: 'background'` |
| 6 | Foreground the app | `app_state_changed` with `from: 'background'`, `to: 'active'` |

---

## Test 9: Orientation Duration

| Step | Action | Expected Analytics Event |
|---|---|---|
| 1 | Enter game (portrait default) | — |
| 2 | Toggle to landscape | `orientation_changed` with `orientation: 'landscape'`, `previous_orientation: 'portrait'` + `orientation_session_duration` for portrait |
| 3 | Toggle back to portrait after ~20s | `orientation_session_duration` for landscape (≈ 20s) |

---

## Test 10: Throwables

| Step | Action | Expected Analytics Event |
|---|---|---|
| 1 | Open throwable picker in multiplayer | — |
| 2 | Select and throw an egg at a player | `throwable_sent` with `throwable_type: 'egg'` |
| 3 | Receive a throwable from another player | `throwable_received` with `throwable_type` and `from_name` |

---

## Test 11: Settings Screen

| Step | Action | Expected Analytics Event |
|---|---|---|
| 1 | Toggle Sound OFF | `setting_changed` with `setting: 'sound'`, `enabled: 0` |
| 2 | Toggle Sound ON | `setting_changed` with `setting: 'sound'`, `enabled: 1` |
| 3 | Toggle Vibration OFF | `setting_changed` with `setting: 'vibration'`, `enabled: 0` |
| 4 | Change language to German | `language_changed` with `language: 'de'`, `previous_language: 'en'` |
| 5 | Clear cache | `cache_cleared` with `keys_removed` count |
| 6 | Initiate delete account (cancel before confirming) | `delete_account_initiated` |
| 7 | Submit bug report | `bug_report_submitted` with `description_length` |

---

## Test 12: Game Abandonment

| Step | Action | Expected Analytics Event |
|---|---|---|
| 1 | Start a multiplayer game | — |
| 2 | Press Leave Game button | Confirmation dialog appears |
| 3 | Confirm leave | `game_abandoned` + `game_not_completed` with `reason: 'player_left'` |

---

## Test 13: Sentry Translation Error Tagging

| Step | Action | Expected Sentry Behavior |
|---|---|---|
| 1 | Change language to one with missing keys (e.g., Arabic) | `reportMissingTranslation` breadcrumbs in Sentry |
| 2 | Navigate through screens with missing translations | Sentry breadcrumbs accumulate with `category: 'i18n'` |
| 3 | Trigger an error while missing translations exist | Error event tagged with `category: 'translation'`, `level: 'warning'` |

---

## Test 14: avg_cards_left Fix

| Step | Action | Expected Behavior |
|---|---|---|
| 1 | Play a multiplayer game with 3+ matches (rounds) | — |
| 2 | In match 1, finish with 5 cards remaining | — |
| 3 | In match 2, finish with 1 card remaining | — |
| 4 | In match 3, finish with 3 cards remaining | — |
| 5 | Check player stats after game | `avg_cards_left` should reflect average (≈ 3), NOT just match 3's value (3) |

**Verification:** Check the `complete-game` edge function payload — `cards_left` should be the average across all matches, not just the final one.

---

## Test 15: Supabase game_hands_training Table

| Step | Action | Expected Behavior |
|---|---|---|
| 1 | Open Supabase dashboard → Table Editor | `game_hands_training` table exists |
| 2 | Check table has 30 columns | All columns match schema in docs |
| 3 | Check 6 indexes exist | session, combo, bot, outcome, created, player_hash |
| 4 | Verify RLS is enabled | Only service_role can insert/select |

**Note:** Data population requires a separate edge function update (not included in this PR). The table is ready to receive data.

---

## Quick Smoke Test Checklist

- [ ] App launches without crashes
- [ ] Navigate between 3+ screens → check `screen_time` events in Firebase DebugView
- [ ] Play a local AI game → check sort/hint/play events fire
- [ ] Play a multiplayer game → check connection, turn time, game events
- [ ] Open/close chat drawer → check `chat_session_duration`
- [ ] Change a setting → check `setting_changed` event
- [ ] Check Supabase for `game_hands_training` table existence
- [ ] Check Sentry for any new errors (should be none)
