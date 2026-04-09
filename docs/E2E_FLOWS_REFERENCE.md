# E2E Flows Reference — New Flows & Modifications

**Branch:** `fix/sprint-5-infrastructure-polish-tech-debt`  
**Last updated:** 2026-04-09  
**Flows directory:** `apps/mobile/e2e/flows/`  
**WIP flows directory:** `apps/mobile/e2e/flows-wip/`

---

## Flow Tag Glossary

| Tag | What it means | Runs in CI |
|-----|---------------|-----------|
| `ci` | Smoke flows — no auth session required | ✅ Yes (always) |
| `smoke` | Same as `ci` (subset of ci-tagged flows) | ✅ Yes |
| `ci-authenticated` | Requires injected Supabase auth session + consent bypass | ⏸ Not yet (injection unstable) |
| `navigation` | Screen-navigation smoke (01-29 subset) | ✅ Yes (tagged `ci`) |
| `game` | Offline game launch smoke | ✅ Yes |
| `rooms` | Room create/join smoke | ✅ Yes |
| `livekit` | LiveKit voice/video smoke | ✅ Yes |
| `multiplayer` | Full multiplayer game flow | ✅ Yes |

---

## Flows Present at Last Green CI (`7f5dbfd4`, 2026-04-08)

These 14 flows have been in CI longest and are the most stable:

| # | File | Description | Tag |
|---|------|-------------|-----|
| 01 | `01_app_launch.yaml` | App launch, sign-in screen renders | smoke, ci |
| 02 | `02_game_selection.yaml` | Game selection screen (authenticated view) | smoke |
| 03 | `03_home_navigation.yaml` | Home screen navigation tabs | smoke |
| 04 | `04_create_room.yaml` | Create room flow | rooms |
| 05 | `05_join_room.yaml` | Join room flow | rooms |
| 06 | `06_offline_game.yaml` | Offline bot game launch | game |
| 07 | `07_match_history.yaml` | Leaderboard & profile navigation | navigation |
| 08 | `08_settings_how_to_play.yaml` | Settings & How to Play screen | navigation |
| 09 | `09_livekit_voice_video.yaml` | LiveKit voice/video chat happy path | livekit |
| 10 | `10_sign_in_content_check.yaml` | Sign-in screen element validation (testID selectors) | smoke, ci |
| 11 | `11_app_relaunch_state.yaml` | App relaunch state reset | smoke, ci |
| 12 | `12_multiplayer_game_flow.yaml` | Full multiplayer flow: create → join → play → win | multiplayer |
| 13 | `13_sign_in_interaction.yaml` | Sign-in screen interaction & error handling | smoke, ci |
| 14 | `14_app_stability_cold_starts.yaml` | Stability under 3× repeated cold starts | smoke, ci |

---

## New Flows Added Since Last Green CI

### Flows 15-29 — Extended Smoke Coverage (commit `2fc77734`)

Added as part of the 5th Copilot review round. All tagged `ci` (run in smoke phase). No auth required.

| # | File | Description | What it validates |
|---|------|-------------|-------------------|
| 15 | `15_privacy_consent_accept_persistence.yaml` | Privacy consent accept path & persistence | Consent modal accept stores decision; modal does NOT reappear on relaunch |
| 16 | `16_app_background_foreground_resume.yaml` | App background & foreground resume | App resumes correctly after being backgrounded |
| 17 | `17_hot_relaunch_stability.yaml` | Hot relaunch stability (no state clear) | App survives multiple hot relaunches without crashing |
| 18 | `18_privacy_consent_ui_completeness.yaml` | Privacy consent modal UI completeness | All consent modal UI elements are present and correct |
| 19 | `19_sign_in_button_rapid_tap.yaml` | Google Sign-In button rapid tap resilience | No crash or duplicate nav on rapid taps |
| 20 | `20_landscape_orientation_sign_in.yaml` | Sign-in screen layout in landscape | Layout correct in `LANDSCAPE_LEFT` orientation |
| 21 | `21_network_resilience_sign_in.yaml` | Intermittent network resilience on sign-in screen | Sign-in screen handles flaky network gracefully |
| 22 | `22_leaderboard_screen.yaml` | Leaderboard screen smoke | Screen renders with `ci` tag |
| 23 | `23_profile_screen.yaml` | Profile screen smoke | Screen renders |
| 24 | `24_stats_screen.yaml` | Stats screen smoke | Screen renders |
| 25 | `25_match_type_selection_screen.yaml` | Match type selection screen smoke | Screen renders |
| 26 | `26_matchmaking_screen.yaml` | Matchmaking screen smoke | Screen renders |
| 27 | `27_notifications_screen.yaml` | Notifications screen smoke | Screen renders (emoji removed from assertVisible, fixed `618300d8`) |
| 28 | `28_notification_settings_screen.yaml` | Notification settings screen smoke | Screen renders |
| 29 | `29_lobby_screen.yaml` | Lobby screen smoke | Screen renders |

**Modifications to flows 15-29:**
- **`20_landscape_orientation_sign_in.yaml`** — `setOrientation: landscape` → `setOrientation: LANDSCAPE_LEFT` (commit `faf934a5`, `b0069b58`). Bare `landscape` was rejected by Maestro 2.x.
- **`27_notifications_screen.yaml`** — removed emoji character from `assertVisible` (commit `618300d8`). Maestro threw `Unknown Property: id` on emoji Unicode in assertVisible.
- **All 15-29** — `extendedWaitUntil` assertions with bare `id: foo` wrapped in `visible: true` (commit `fcacb67c`). Required by Maestro 2.x API change.

---

### Flows 30-65 — Authenticated Screen Coverage (commit `1f41e651`)

36 flows tagged `ci-authenticated`. Require an injected Supabase session AND `@big2_analytics_consent=false` in AsyncStorage. **Not running in CI yet** — auth injection has not been stabilised.

| # | File | Description |
|---|------|-------------|
| 30 | `30_ci_home_all_buttons.yaml` | Home screen — all buttons visible and tappable |
| 31 | `31_ci_find_game_modal.yaml` | Find Game modal — Casual & Ranked buttons |
| 32 | `32_ci_offline_difficulty_modal.yaml` | Offline Difficulty modal — Easy / Medium / Hard |
| 33 | `33_ci_settings_screen_full.yaml` | Settings screen — full walk-through |
| 34 | `34_ci_profile_screen_full.yaml` | Profile screen — full walk-through |
| 35 | `35_ci_leaderboard_full.yaml` | Leaderboard screen — full walk-through (all tabs) |
| 36 | `36_ci_stats_screen_full.yaml` | Stats screen — full walk-through |
| 37 | `37_ci_notifications_full.yaml` | Notifications screen — full walk-through |
| 38 | `38_ci_notification_settings_full.yaml` | Notification settings — full walk-through |
| 39 | `39_ci_match_type_selection_full.yaml` | Match type selection — all buttons |
| 40 | `40_ci_matchmaking_casual_cancel.yaml` | Matchmaking casual — start then cancel |
| 41 | `41_ci_matchmaking_ranked_cancel.yaml` | Matchmaking ranked — start then cancel |
| 42 | `42_ci_bug_report_modal.yaml` | Bug report modal — open, fill, dismiss |
| 43 | `43_ci_offline_easy_game_controls.yaml` | Offline easy game — full controls & helper buttons |
| 44 | `44_ci_offline_medium_game.yaml` | Offline medium game |
| 45 | `45_ci_offline_hard_game.yaml` | Offline hard game |
| 46 | `46_ci_offline_in_game_settings.yaml` | Offline game — in-game settings (camera/mic) |
| 47 | `47_ci_offline_landscape.yaml` | Offline game — landscape orientation |
| 48 | `48_ci_create_room_full.yaml` | Create Room screen — full validation |
| 49 | `49_ci_join_room_validation.yaml` | Join Room screen — validation & back nav |
| 50 | `50_ci_lobby_screen.yaml` | Lobby screen — display & navigation |
| 51 | `51_ci_offline_1v3_bots_4player.yaml` | Offline 1 human vs 3 bots (4-player simulation) |
| 52 | `52_ci_offline_helper_buttons_sequence.yaml` | Offline game — all helper buttons in sequence |
| 53 | `53_ci_offline_play_button.yaml` | Offline game — select card then play |
| 54 | `54_ci_game_selection_all_cards.yaml` | Game selection screen — all game cards |
| 55 | `55_ci_offline_hard_stress.yaml` | Offline hard game — extended pass sequence stress |
| 56 | `56_ci_create_room_start_with_bots.yaml` | Create Room → Lobby → Start with bots |
| 57 | `57_ci_leaderboard_stats_nav.yaml` | Leaderboard → Stats navigation |
| 58 | `58_ci_join_room_back.yaml` | Join Room → Back navigation |
| 59 | `59_ci_background_foreground_game.yaml` | App background/foreground during game |
| 60 | `60_ci_match_history_full.yaml` | Match History screen — scroll and verify |
| 61 | `61_ci_offline_rapid_tap_stability.yaml` | Offline game — rapid tap stress on helpers |
| 62 | `62_ci_offline_landscape_settings.yaml` | Offline landscape + settings combination |
| 63 | `63_ci_settings_timer.yaml` | Settings screen — timer setting interaction |
| 64 | `64_ci_create_room_cancel.yaml` | Create Room → Cancel / Back navigation |
| 65 | `65_ci_full_nav_smoke.yaml` | Full navigation smoke — every screen from Home |

**Modifications to flows 30-65:**
- **All 36 flows** — `extendedWaitUntil` `id:` selectors wrapped in `visible: true` (commit `fcacb67c`)
- **All 36 flows** — `setOrientation` calls updated to `LANDSCAPE_LEFT` / `LANDSCAPE_RIGHT` (commit `faf934a5`)
- **All 36 flows** — invalid Maestro command syntax fixed (bare `tapOn:`, wrong indentation) (commit `0b70c1cd`)
- **All 36 flows** — `"Choose a game to play"` assertion timeout increased 8s → 20s (commit `c107b687`). The home screen can take up to 15-20s on CI after a cold Room DB migration.

---

### Flows 66-85 — Game Room Flows (commit `1f41e651`, moved to WIP)

20 flows covering in-game UI: chat, throwables, scoreboards, game-end, reconnect, friends. Placed in `apps/mobile/e2e/flows-wip/` because they require helper sub-flow YAML files that have not been created yet.

**Critical discovery:** Maestro parses **every YAML file** in the directory passed to `maestro test`, regardless of `--include-tags`. Flows 66-85 referenced missing helper sub-flows → parse errors → CI failure. Fixed by moving them to `flows-wip/` (commit `399173d2`).

| # | File | Description |
|---|------|-------------|
| 66 | `66_ci_chat_send_message_portrait.yaml` | Chat — send message, portrait |
| 67 | `67_ci_chat_landscape.yaml` | Chat — landscape layout |
| 68 | `68_ci_throwables_picker_portrait.yaml` | Throwables picker — portrait |
| 69 | `69_ci_throwables_landscape.yaml` | Throwables — landscape |
| 70 | `70_ci_expanded_scoreboard_portrait.yaml` | Expanded scoreboard — portrait |
| 71 | `71_ci_expanded_scoreboard_landscape.yaml` | Expanded scoreboard — landscape |
| 72 | `72_ci_play_history_modal_portrait.yaml` | Play history modal — portrait |
| 73 | `73_ci_play_history_landscape.yaml` | Play history — landscape |
| 74 | `74_ci_game_end_modal_portrait.yaml` | Game-end modal — portrait |
| 75 | `75_ci_game_end_modal_landscape.yaml` | Game-end modal — landscape |
| 76 | `76_ci_game_end_play_again.yaml` | Game-end → Play Again |
| 77 | `77_ci_game_end_share_copy.yaml` | Game-end → Share/Copy |
| 78 | `78_ci_active_game_banner_rejoin.yaml` | Active game banner — rejoin |
| 79 | `79_ci_active_game_banner_leave.yaml` | Active game banner — leave |
| 80 | `80_ci_active_game_banner_online.yaml` | Active game banner — online state |
| 81 | `81_ci_rejoin_modal.yaml` | Rejoin modal |
| 82 | `82_ci_disconnect_reconnect.yaml` | Disconnect & reconnect cycle |
| 83 | `83_ci_friends_add_from_game_room.yaml` | Add friend from game room |
| 84 | `84_ci_friends_add_from_leaderboard.yaml` | Add friend from leaderboard |
| 85 | `85_ci_full_game_room_smoke.yaml` | Full game room smoke — all UI elements |

---

## CI Infrastructure Modifications

### `apps/mobile/scripts/android-e2e.sh`

| Commit | Change | Status |
|--------|--------|--------|
| `28fc69b8` | Added `adb root` before RKStorage injection | ✅ Retained |
| `22e556c7` | First RKStorage injection attempt | ❌ Reverted |
| `c3460db1` | WAL checkpoint before injection | ❌ Reverted |
| `19f4ea5f` | Fix Supabase storage key (`sb-dppybucldqufbqhwnkxu-auth-token`) | ❌ Reverted |
| `b079b09a` | Phase A-D: pre-warm + inject + verify | ❌ Reverted |
| `2083125b` | 30s pre-poll + 90s polling for Room init | ❌ Reverted |
| `6c6abe3c` | Remove root-owned mkdir; re-apply sleep | ❌ Reverted |
| `837db770` | Verify in RKStorage not Room | ❌ Reverted |
| `684217a2` | Pre-warm Room DB (launch → stop → inject) | ❌ Reverted |
| `eccbcfc9` | RKStorage migration path (delete AsyncStorage → inject RKStorage) | ❌ Reverted |
| **Reverted to `7f5dbfd4`** | **Smoke-only: install APK → warm-up → `maestro test --include-tags ci`** | ✅ **Current** |

### `apps/mobile/scripts/ci-seed-e2e-auth.mjs`

This script was created and evolved through the auth injection attempts. It handles the full injection for both platforms:

- **Android:** `adb shell sqlite3 RKStorage 'INSERT OR REPLACE INTO catalystLocalStorage ...'` + consent bypass
- **iOS:** `xcrun simctl get_app_container booted {bundleId} data` to find active container → write to `RCTAsyncLocalStorage_V1/` directory

The script is **not called in CI** after this revert (smoke-only mode). It remains in the codebase for local/manual use and future CI auth phase work.

**Key discoveries embedded in `ci-seed-e2e-auth.mjs`:**

| Discovery | Detail |
|-----------|--------|
| Supabase storage key | `sb-dppybucldqufbqhwnkxu-auth-token` (project-ref embedded in key) |
| Android Room target | `AsyncStorage` DB → table `Storage (key TEXT NOT NULL PK, value TEXT)` |
| Android RKStorage fallback | `RKStorage` SQLite → table `catalystLocalStorage (key TEXT, value TEXT)` |
| async-storage v2 migration trigger | `StorageSupplier.kt`: if `RKStorage` exists AND `AsyncStorage` does NOT → `createFromFile(RKStorage).addMigrations(MIGRATION_TO_NEXT)` |
| iOS storage path | `{NSApplicationSupportDirectory}/{bundleID}/RCTAsyncLocalStorage_V1/` |
| iOS manifest format | `manifest.json`: `{ "key": null }` for large values stored as separate MD5-named files |
| iOS container staleness | Each `clearState: true` in Maestro creates a new container UUID. Always use `xcrun simctl get_app_container` not `find` globs. |
| Consent key | `@big2_analytics_consent` — must be `'false'` (string) to skip consent modal without enabling analytics |

### `.github/workflows/test.yml`

| Commit | Change | Status |
|--------|--------|--------|
| `28338ac5` | Pin Maestro CLI to v1.41.0 | ✅ Retained |
| `d01a09ae` | Add iOS auth injection step + Phase 2 authenticated flows | ❌ Reverted |
| `22e556c7` | Fix iOS injection env var passing | ❌ Reverted |
| `fcacb67c` | `extendedWaitUntil` selector fix | ✅ Retained (in flows) |
| `f6ae429a` | Increase Android step timeout 30→55 min, job 60→120 min | ✅ Retained |
| `919a32f7` | D8 OOM fix (patch `gradle.properties`); iOS ModuleCache clear + v4 cache key | ✅ Retained |
| `d855f736` | iOS: `get_app_container` for container path; uninstall+reinstall re-warm; consent injection | ❌ Reverted |
| **Reverted iOS E2E to `7f5dbfd4`** | **Smoke-only: 2-attempt loop, simple terminate+launch+terminate re-warm** | ✅ **Current** |

---

## Flows Requiring Auth Session (Blocked Until Injection Stabilised)

The following are **not running in CI** and require a working auth injection pipeline:

- **Flows 30-65** (`ci-authenticated` tag) — 36 flows covering the full authenticated app experience
- **Flows 66-85** (`ci-authenticated` tag, in `flows-wip/`) — 20 game room flows (also missing helper sub-flows)

**Prerequisites to unblock:**
1. Deterministic auth session injection for both Android (Room) and iOS (file storage)
2. Consent bypass injection (`@big2_analytics_consent=false`) alongside auth token
3. The injection must happen AFTER Maestro starts (or be re-injected after clearState phases) — see `CI_E2E_FAILURE_POSTMORTEM.md` for full analysis
4. Game room flows (66-85) also need their missing helper sub-flow YAML files to be created

---

## TestID Coverage Added (Alongside Flows 30-65, commit `1f41e651`)

The following components had `testID` props added to support Maestro `id:` selectors:

- Home screen: all navigation buttons (`home-create-room-btn`, `home-join-room-btn`, `home-offline-btn`, etc.)
- Game room UI: card elements (`chinese-poker-card`), game buttons, scoreboard, throwables picker, chat
- Settings screen: timer toggle, notification settings toggles
- Profile, Stats, Leaderboard screens: tab selectors, stat cards
- Matchmaking screens: cancel buttons, status indicators

See the code diff in `1f41e651` for the full list of `testID` additions across component files.
