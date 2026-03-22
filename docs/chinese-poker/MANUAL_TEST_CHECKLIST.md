# Big2 Mobile App — Manual Test Checklist

> Last updated: March 22, 2026  
> Covers all completed tasks through PR #169. Run on a physical device (iOS + Android) where noted.  
> **Key:** ✅ Pass · ❌ Fail · ⏭️ Skip (not applicable) · 🟡 Partial

---

## T1 — GameScreen Render Performance (#628)

> Validates that the GameScreen re-render fix (PR #156) eliminated the 263 slow renders per session.

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 1.1 | Open a multiplayer game (4 players, online) | Game loads within 2s, no freeze |
| 1.2 | Play 3–5 cards consecutively at a normal pace | UI responds immediately; no stuttering or dropped frames |
| 1.3 | Enable React Native DevTools Performance overlay during a game | Re-renders per 10-second window should be ≤ 20 (down from 263) |
| 1.4 | Let the auto-pass timer run down to 0 and trigger on all 4 players | Timer ring animates smoothly on the UI thread; no JS jank |
| 1.5 | Play a complete game round (one player wins all cards) | Game-over screen appears; no lag or white flash on transition |

---

## T2 — React Error Boundaries (#643)

> Validates that a runtime error in GameScreen or sub-components shows a recovery UI instead of crashing.

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 2.1 | Open the app and navigate to Home screen | App loads normally |
| 2.2 | Temporarily add `throw new Error('test')` to `GameScreen.tsx` render, build dev, launch a game | Fallback error UI is shown (not a blank/white crash screen) |
| 2.3 | Tap the "Try Again" / retry button on the error boundary screen | App attempts recovery; navigates back to Home or previous screen |
| 2.4 | Remove the test throw; verify normal game launch works again | Game loads correctly |
| 2.5 | Join a lobby with 4 players and verify no unhandled promise rejection or JS crash | Game plays end-to-end without an error boundary activating |

---

## T3 — In-Game Text Chat (#648)

> Validates the Supabase Realtime chat feature (PR #150).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 3.1 | Start a 4-player multiplayer game | Chat icon/button is visible in the in-game UI |
| 3.2 | Tap the chat button | Chat drawer/modal opens |
| 3.3 | Type a message (up to 200 characters) and tap Send | Message appears in the chat list with your username and timestamp |
| 3.4 | Have a second device / second account in the same game | Other player's message appears in real-time (< 1s delay) |
| 3.5 | Send a message while it is NOT your turn | Message sends successfully; chat does not block gameplay |
| 3.6 | Close the chat modal; verify the game state is unchanged | Game continues from same state; no turn skip or timer reset |
| 3.7 | Send an emoji (e.g. 😂) | Emoji renders correctly in the message bubble |
| 3.8 | A player quits mid-game; remaining players send a chat | Messages still arrive; no crash on the disconnected player's removal |

---

## T4 — Deep Linking, Friends List & Game Invite Share (#646)

> Validates invite deep links and friends list UI (PR #163).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 4.1 | In the Lobby, tap **Share Invite** | Share sheet opens with a `big2mobile://lobby/<roomCode>?joining=true` URL |
| 4.2 | On a second device, tap the shared link while the app is closed | App opens directly to the Lobby for that room |
| 4.3 | On a second device, tap the shared link while the app is in the background | App foregrounds and navigates to the Lobby for that room |
| 4.4 | On a second device, tap the link while **not signed in** | App opens to sign-in; after sign-in, navigates to the Lobby automatically |
| 4.5 | Open the Friends list from the profile/home screen | Friends list renders with online status indicators |
| 4.6 | Tap a friend → **Invite to Game** | Invite is sent; friend receives a push notification |
| 4.7 | Accept a game invite notification on iOS | Navigates to the correct Lobby; joining=true state is preserved |

---

## T5 — Drop Zone UX Enhancements (#652)

> Validates glow, haptic feedback, and drag hint on the play zone (PR #160).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 5.1 | Select 1–5 valid cards in your hand (it is your turn) | Cards lift/highlight; drop zone appears |
| 5.2 | Start dragging selected cards toward the drop zone | Drop zone pulses or glows as cards approach |
| 5.3 | Drop cards into the zone | Haptic feedback fires (light impact); drop zone accepts cards |
| 5.4 | Select invalid combo (e.g. 3 non-matching cards) and drag | Drop zone shows rejection state (red glow / no-entry indicator); haptic feedback fires |
| 5.5 | On a device with haptics disabled (Settings → Sound & Haptics off) | No crash; drop zone still shows visual feedback |
| 5.6 | On first game launch (for a new user), a drag hint animation is shown | Subtle animated arrow or highlight pointing to drop zone |

---

## T6 — Zustand Store Expansion (#647)

> Validates that prop-drilling through Context was replaced by Zustand selectors (PR #165).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 6.1 | Navigate between Home → Lobby → Game → Home rapidly | No stale state leaks; UI reflects current game state correctly on each screen |
| 6.2 | Start a game, background the app for 30 seconds, foreground | Game state is preserved; player hand and scores unchanged |
| 6.3 | Change a setting (e.g. volume, card sort order) in Settings | Setting persists when returning to Home and starting a new game |
| 6.4 | Run `pnpm test` and check that all store-related tests pass | No failing tests referencing Context or Zustand store |

---

## T7 — CI Bundle Size Monitoring (#616)

> Validates that the bundlewatch/size-limit CI gate is active (PR #165).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 7.1 | Push a trivial code change to a branch and open a PR | CI runs the bundle size check job |
| 7.2 | Check the bundle size report in CI artifacts or PR comment | Report shows current bundle size vs threshold; PR passes if under limit |
| 7.3 | Check the size-limit thresholds in `package.json` or `.size-limit.json` | Thresholds are defined (e.g. JS bundle < X MB) |

---

## T8 — Coverage Thresholds (#617)

> Validates that Jest coverage thresholds enforce ≥ prior sprint baseline + 2% (PR #165).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 8.1 | Run `pnpm test --coverage` locally | All coverage thresholds pass (statements/branches/functions/lines) |
| 8.2 | Open `jest.config.js` and verify `coverageThreshold` is set | Thresholds present for `global` and/or `src/game/` path |
| 8.3 | Delete a test file temporarily and re-run coverage | Coverage drops below threshold; Jest exits with code 1 |
| 8.4 | Restore the test file | Coverage passes again |

---

## T9 — Performance Benchmarks for Card Rendering (#328)

> Validates that card rendering benchmark tests exist and pass in CI (PR #165).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 9.1 | Run `pnpm test` | Benchmark tests in `__tests__/` that reference "render performance" or timing pass |
| 9.2 | Check CI on a PR targeting `game/chinese-poker` or `main` | Performance benchmark job passes (no regression flag) |
| 9.3 | Open the benchmark test file; verify it measures actual render durations | Test asserts render time < a defined threshold (e.g. < 16ms avg) |

---

## T10 — E2E Tests: Maestro Flows 10 & 11 (#325)

> Validates the new E2E flows and Android EAS test profile (PR #167).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 10.1 | Run `maestro test apps/mobile/e2e/flow-10.yaml` on an iOS simulator | Flow completes without assertion failures |
| 10.2 | Run `maestro test apps/mobile/e2e/flow-11.yaml` on an iOS simulator | Flow completes without assertion failures |
| 10.3 | Check `eas.json` for `test` profile | `test` profile exists under `build` section with correct settings |
| 10.4 | Run `eas build --profile test --platform android` (or check CI log) | Android EAS test build completes; Maestro flows run in post-build |
| 10.5 | Push to `game/chinese-poker` or a PR branch | CI E2E job triggers and the new flows run green |

---

## T11 — Visual Regression / Snapshot Tests for Card UI (#327)

> Validates that 21 card UI snapshot tests were added and pass (PR #167).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 11.1 | Run `pnpm test -- CardVisualRegression` | 21 snapshot tests pass |
| 11.2 | Change a Card component style (e.g. border radius) | Existing snapshots fail with diff output |
| 11.3 | Run `pnpm test -- CardVisualRegression --updateSnapshot` | Snapshots update correctly |
| 11.4 | Restore the Card style change | Tests pass with original snapshots |

---

## T12 — Comprehensive Unit / Integration Tests (#273)

> Validates the game-logic test suite: 79 suites, 1338 tests (PR #167).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 12.1 | Run `pnpm test` | 79/79 suites pass; 1338 tests pass; 0 failures |
| 12.2 | Run `pnpm test -- highest-play-detector` | All highest-play-detector tests pass, including `canFormAnyFullHouse` single-rank false-positive fix |
| 12.3 | Run `pnpm test -- canBeatPlay` | `canBeatPlay` cache key tests pass (uses `makeCacheKey` for both sides) |
| 12.4 | Run `pnpm test -- game-logic` | Full game-logic suite passes; full-house, four-of-a-kind, and straight variants all validate correctly |

---

## T13 — Rejoin Testing (#522)

> Validates the rejoin banner and game state continuity (PR #151).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 13.1 | Start a 4-player game; kill the app on one device mid-game | Other 3 players are not affected; game continues with timeout/bot for disconnected player |
| 13.2 | Reopen the app on the disconnected device within 60 seconds | Rejoin banner appears at the top ("Reconnecting to game...") |
| 13.3 | Tap the rejoin banner or wait for automatic rejoin | Player returns to correct game state; hand is intact; score is correct |
| 13.4 | After rejoining, play a valid card | Card plays successfully; other players see it |
| 13.5 | Start a NEW game after the previously disonnected game ended | play_history resets correctly; new game's plays appear (no ghost plays from prior game) |
| 13.6 | Force-close the app between two consecutive games | `lastSyncedPlayCountRef` resets to 0; next game's plays are not skipped |

---

## T14 — Accessibility: VoiceOver / TalkBack (#645)

> Validates WCAG 2.1 AA improvements in Card.tsx and GameControls.tsx (PR #168).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 14.1 | **iOS:** Enable VoiceOver (Settings → Accessibility → VoiceOver) | VoiceOver activates |
| 14.2 | Navigate to the game screen with VoiceOver; swipe through cards | Each card announces its rank and suit (e.g. "Ace of Spades") |
| 14.3 | Double-tap a card to select it with VoiceOver | Card selection is announced ("selected" / "deselected") |
| 14.4 | With cards selected, focus the Play button | Announces "Play, button" and whether play is enabled/disabled |
| 14.5 | With cards selected, focus the Pass button | Announces "Pass, button" and whether pass is enabled |
| 14.6 | When it becomes your turn, the turn announcement fires | VoiceOver announces "Your turn" via `accessibilityLiveRegion` |
| 14.7 | **Android:** Enable TalkBack (Settings → Accessibility → TalkBack) | Same announcements as 14.2–14.6; no missing labels |
| 14.8 | Select multiple cards with TalkBack active | Combo type announced (e.g. "Pair selected") |
| 14.9 | Run `pnpm test -- CardVisualRegression` | Updated snapshots with `accessibilityLabel` / `accessibilityHint` props pass |

---

## T15 — Game Engine Optimization / Memoization (#280)

> Validates `classifyCards` and `sortHand` memoization, lazy bot AI (PR #168).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 15.1 | Play 20 consecutive card plays in a local bot game | No perceptible lag; UI remains responsive between plays |
| 15.2 | Open React Native DevTools profiler; play 10 cards | `classifyCards` and `sortHand` show minimal repeated computation (calls drop after first classification of the same hand) |
| 15.3 | Let 3 bots take turns rapidly (offline practice mode) | Bot turns resolve quickly (< 500ms each); no ANR (Application Not Responding) |
| 15.4 | Run `pnpm test -- game-logic` | Cache-related assertions in game-logic tests pass |
| 15.5 | Play a full game to completion offline | Total game duration is < 3 minutes for bot-only game; no memory leaks (check DevTools heap) |

---

## T16 — Bundle Size & Performance Optimization (#276)

> Validates Hermes engine, metro tree-shaking, and ≤ 50MB / ≤ 3s cold start (PR #168).

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 16.1 | Build a release APK: `eas build --profile production --platform android` | Build succeeds; Hermes engine is enabled (check build logs for `hermes: true`) |
| 16.2 | Install the release APK on a mid-range Android device (e.g. Pixel 4a) | App cold start (first open after install) ≤ 3 seconds |
| 16.3 | Check the APK download size in Play Store internal testing or the build artifact | APK / AAB size ≤ 50 MB |
| 16.4 | Build a release IPA and check `.ipa` file size | IPA size ≤ 50 MB |
| 16.5 | Open app on iOS: time from tap to Home screen visible | ≤ 3 seconds on iPhone 11 or newer |
| 16.6 | Check `metro.config.js` for tree-shaking / module exclusion rules | Config references asset exclusions or module replacements consistent with the size reduction |
| 16.7 | Run the CI bundle size check job (from T7) after the PR | Bundle size report shows ≤ prior reported size |

---

## T17 — Notification Deep Link When Logged Out (#646 / PR #166)

> Validates that a notification tapped before sign-in is replayed after authentication.

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 17.1 | Sign out of the app completely | App shows sign-in screen |
| 17.2 | On another device, send a game invite that triggers a push notification | Notification appears on the signed-out device |
| 17.3 | Tap the notification on the signed-out device | App opens to sign-in screen (deep link is queued, not lost) |
| 17.4 | Complete sign-in | App navigates to the correct Lobby / screen matching the notification type |
| 17.5 | Repeat with a `your_turn` notification type | Navigates to the Game screen after sign-in |
| 17.6 | Repeat with a `friend_request` notification | Navigates to the Profile screen after sign-in |

---

## T18 — Lobby Leave Confirmation i18n (#628 / PR #157)

> Validates that lobby leave confirmation dialogs are translated in all 3 supported languages.

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 18.1 | Set device language to **English**; join a lobby as host; tap Leave | Dialog shows English: "Leave Lobby?", "You are the host…", Yes/No buttons |
| 18.2 | Set device language to **Arabic**; join a lobby; tap Leave | Dialog shows Arabic translations; text is right-to-left aligned |
| 18.3 | Set device language to **German**; join a lobby; tap Leave | Dialog shows German translations; no raw translation key strings are visible |
| 18.4 | Join as a non-host **ready** player; tap Leave | Dialog shows the "ready player" variant message (not the host message) |
| 18.5 | Join as a non-host **not-ready** player; tap Leave | Dialog shows the standard leave message |

---

## T19 — Regression Smoke Tests (Full Flow)

> End-to-end happy path to confirm nothing regressed across all changes.

| # | Test Step | Expected Result |
|---|-----------|----------------|
| 19.1 | Fresh install (delete app data); launch app | Onboarding / sign-in screen appears; no crash |
| 19.2 | Sign in with a test account | Home screen loads; friends list visible |
| 19.3 | Create a room (4 players) | Lobby screen with room code appears |
| 19.4 | 3 other test accounts join via deep link | All 4 avatars shown as ready |
| 19.5 | Host starts the game | Cards dealt; turn order visible; correct player's turn highlighted |
| 19.6 | Play through at least one complete round | Score updates; next round deals correctly |
| 19.7 | Use chat during the game | Messages visible to all players in < 1s |
| 19.8 | One player disconnects and reconnects | Rejoin banner shown; player rejoins with correct state |
| 19.9 | Play to game end (one player holds no cards) | Game-over screen shows rankings and scores |
| 19.10 | Return to Home; verify stats updated | Wins/losses/ELO reflect the completed game |

---

## How to Log Results

Mark each row: **✅ Pass**, **❌ Fail**, or **⏭️ Skip**.  
For failures, note device model + OS version and open a GitHub issue linking back to the task ID.

```
Device tested: _______________  OS: ___________  Date: ___________
Tester: _______________________
```
