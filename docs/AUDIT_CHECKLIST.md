# Big-Two-Neo — Audit Fix Checklist

Track progress on all audit findings. Check off items as they are resolved.

---

## 🔴 Critical — Fix First

- [x] **C1** — Fix unbounded array growth in `GameStateManager`
  - **File:** `src/game/state.ts`
  - **Task:** #629
  - **Fix:** Added `matchNumber` field to `RoundHistoryEntry`; tagged every push to `gameRoundHistory` with the current match number; added prune logic in `startNewMatch()` to filter entries older than `currentMatch - 20` once the session exceeds 20 matches. `played_cards` was already correctly cleared per match (no change required).
  - **Branch:** `task/629-fix-unbounded-array-growth`
  - **Why:** `gameRoundHistory` grew indefinitely across matches → OOM on 2GB RAM devices; pruning caps in-memory + AsyncStorage serialised state to ≤ 20 matches of entries (~1 600 entries max).

- [ ] **C2** — Fix `setInterval` timer leak on component unmount
  - **File:** `src/game/state.ts`
  - **Task:** #630
  - **Fix:** Ensure `GameStateManager.destroy()` is always called in the `useEffect` cleanup of every owner component
  - **Why:** 100ms interval runs forever if `destroy()` is skipped, draining battery and executing stale callbacks

- [ ] **C3** — Fix broken push notification edge function
  - **File:** `supabase/functions/send-push-notification/index.ts` (~line 67)
  - **Task:** #632
  - **Fix:** Rename the duplicate `const now` declaration to eliminate `SyntaxError: Identifier 'now' has already been declared`
  - **Why:** Function crashes at runtime — no push notifications sent for game invites or turn reminders

- [ ] **C4** — Remove `.bak` files from version control
  - **Task:** #631
  - **Fix:**
    ```bash
    git rm src/**/*.bak
    echo "*.bak" >> .gitignore
    git commit -m "chore: remove .bak files from version control"
    ```
  - **Files to remove:**
    - `src/screens/GameScreen.tsx.bak`
    - `src/components/game/CardHand.tsx.bak`
    - `src/components/game/GameControls.tsx.bak`
    - `src/components/gameEnd/GameEndModal.tsx.bak`
    - `src/hooks/useMatchmaking.ts.bak`
    - `src/hooks/useRealtime.ts.bak`
    - `src/hooks/useGameStateManager.ts.bak`
    - `src/hooks/useConnectionManager.ts.bak`
    - `src/hooks/usePlayHistoryTracking.ts.bak`
    - `src/hooks/__tests__/useRealtime-timer-cancellation.test.ts.bak`

---

## 🟠 High Priority

- [ ] **H1** — Extract disconnect logic into a dedicated hook/reducer
  - **File:** `src/screens/MultiplayerGame.tsx` lines 580–842
  - **Task:** #633
  - **Fix:** Create `src/hooks/useDisconnectStateMachine.ts` with explicit states: `connected → timeout_pending → confirming → disconnected → recovering`. Use `useReducer` for transitions.
  - **Why:** 263-line `useEffect` with 6+ nesting levels is untestable and error-prone

- [ ] **H2** — Wrap `GameView` in `React.memo`
  - **File:** `src/screens/GameView.tsx`
  - **Task:** #635
  - **Fix:** `export default React.memo(GameView)` and add `useCallback` to all callback props passed from `MultiplayerGame`
  - **Why:** Without memo, every heartbeat or realtime tick triggers a full 50-prop subtree re-render

- [ ] **H3** — Migrate `InactivityCountdownRing` to Reanimated UI thread
  - **File:** `src/components/game/InactivityCountdownRing.tsx`
  - **Task:** #634
  - **Fix:** Replace `requestAnimationFrame` + `setState` with `useSharedValue` + `useDerivedValue` from `react-native-reanimated`. All animation runs on UI thread.
  - **Why:** RAF + setState fires JS-thread re-renders at ~15fps, competing with game logic

- [ ] **H4** — Consolidate `GameView` props into `GameContext`
  - **Files:** `src/screens/GameView.tsx`, `src/screens/MultiplayerGame.tsx`
  - **Task:** #638
  - **Fix:** Create `src/contexts/GameContext.tsx` (or Zustand slice). Subscribe `GameView` and child components to context instead of receiving 50+ pass-through props.
  - **Why:** 50 individual props make `GameView` API incomprehensible and block `React.memo` effectiveness

- [ ] **H5** — Split `HomeScreen.tsx` into focused modules
  - **File:** `src/screens/HomeScreen.tsx` (1,643 LOC)
  - **Task:** #637
  - **Fix:** Extract into:
    - `src/hooks/useMatchmakingFlow.ts` — all matchmaking RPC + state logic
    - `src/hooks/useRoomCleanup.ts` — room cleanup on reconnect
    - `src/components/home/MatchmakingPanel.tsx` — the matchmaking UI section
    - Keep `HomeScreen.tsx` as thin coordinator (~200 LOC)
  - **Why:** Screen handles UI + matchmaking RPC + room cleanup + polling + AsyncStorage — impossible to test

---

## 🟡 Medium Priority

- [ ] **M1** — Move root scripts to `scripts/` directory
  - **Location:** `/apps/mobile/*.mjs`, `/apps/mobile/*.sh` (18 files)
  - **Task:** #636
  - **Fix:**
    ```bash
    mv apps/mobile/*.mjs apps/mobile/scripts/
    mv apps/mobile/*.sh apps/mobile/scripts/
    # Create apps/mobile/scripts/README.md documenting each script
    ```
  - **Why:** 18 scripts at root pollute workspace and confuse `ls` output

- [ ] **M2** — Squash Supabase migrations into a baseline
  - **Location:** `supabase/migrations/` (128 files)
  - **Task:** #640
  - **Fix:** Run `supabase db dump --local > supabase/migrations/baseline.sql`, then delete old migration files. Keep only new migrations going forward.
  - **Why:** 128 migrations slow CI and local DB reset

- [ ] **M3** — Eliminate matchmaking race condition
  - **File:** `src/hooks/useMatchmaking.ts`
  - **Task:** #641
  - **Fix:** Remove recursive `setTimeout` polling. Use Supabase Realtime as the single source of truth. Add a debounce guard on game-start transition.
  - **Why:** Polling + Realtime can both fire simultaneously, duplicating game-start actions

- [ ] **M4** — Replace O(N) `.find()` lookups with O(1) Map in `useMultiplayerLayout`
  - **File:** `src/hooks/useMultiplayerLayout.ts`
  - **Task:** #639
  - **Fix:**
    ```typescript
    const playerMap = useMemo(
      () => new Map(players.map(p => [p.id, p])),
      [players]
    );
    // Replace all .find(p => p.id === x) with playerMap.get(x)
    ```
  - **Why:** 4 chained `.find()` calls per render — avoidable overhead

- [ ] **M5** — Add missing ESLint peer dependencies
  - **File:** `package.json`
  - **Task:** #642
  - **Fix:**
    ```bash
    pnpm add -D eslint-plugin-react-hooks eslint-plugin-react-native
    ```
  - **Why:** Missing peer deps cause ESLint to fail silently or use wrong plugin versions

- [ ] **M6** — Remove unused `expo-linear-gradient`
  - **File:** `package.json`
  - **Task:** #644
  - **Fix:**
    ```bash
    pnpm remove expo-linear-gradient
    ```
  - **Why:** Confirmed unused by depcheck; adds native build weight for no benefit

---

## 🟢 Low Priority

- [ ] **L1** — Add Error Boundaries around game screens
  - **Files:** `src/navigation/AppNavigator.tsx`, `src/screens/MultiplayerGame.tsx`
  - **Task:** #643
  - **Fix:** Create `src/components/ErrorBoundary.tsx`. Wrap game screen stack in `AppNavigator` with `<GameErrorBoundary onRetry={reset}>`. Log errors to Sentry/LogRocket in `componentDidCatch`.
  - **Why:** Any unhandled JS exception shows a blank white screen with no recovery path

- [ ] **L2** — Add VoiceOver / accessibility support
  - **Files:** `src/components/game/Card.tsx`, `src/components/game/GameControls.tsx`
  - **Task:** #645
  - **Fix:**
    - Add `accessibilityLabel`, `accessibilityRole="button"`, `accessibilityState={{ selected: isSelected }}` to `Card`
    - Add `AccessibilityInfo.announceForAccessibility("Your turn")` in `GameControls` when local player turn begins
    - Add `accessibilityHint` to play/pass buttons
  - **Why:** App is completely unusable with VoiceOver enabled

- [ ] **L3** — Configure deep linking for room codes
  - **File:** `src/navigation/AppNavigator.tsx`, `app.json`
  - **Task:** #646
  - **Fix:** Add `scheme: "bigtwo"` to `app.json`. Configure `linking` prop on `NavigationContainer` with route `bigtwo://room/:roomCode`. Handle incoming URL in `useMatchmaking`.
  - **Why:** Players cannot share room links; hurts onboarding and social virality

- [ ] **L4** — Expand Zustand store to reduce prop drilling
  - **File:** `src/store/index.ts`
  - **Task:** #647
  - **Fix:** Migrate auth state, current room metadata, active game state, and UI preferences into Zustand slices. Remove equivalent React context providers where possible.
  - **Why:** Store exists but is mostly empty — context and prop drilling persist throughout the app

- [ ] **L5** — Increase card touch targets to iOS HIG 44px minimum
  - **Files:** `src/components/game/Card.tsx`, `src/utils/cardOverlap.ts`
  - **Task:** #650
  - **Fix (quick):** Add `hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}` to the card gesture handler
  - **Fix (better):** Reduce overlap percentage in `cardOverlap.ts` for portrait orientation
  - **Fix (best UX):** Fan arc layout that fans cards upward on long-press
  - **Why:** At 70%+ overlap, visible card width is ~22px — below the 44px HIG minimum

---

## 📦 Feature Backlog (implement after C1–H3 are resolved)

- [ ] **F1** — In-game text chat
  - **Task:** #648
  - **Approach:** Supabase Realtime broadcast on the room channel. Collapsible chat drawer from bottom of game screen. Rate limit: 1 msg/2s per player server-side.
  - **Prerequisite:** C1, C2, H2 complete (memory + render stability)

- [ ] **F2** — In-game voice chat
  - **Task:** #649
  - **Approach:** Evaluate Agora SDK, LiveKit, or Daily.co. Push-to-talk toggle in `GameControls`. Mute indicator per player in `PlayerInfo`. Requires microphone permission flow.
  - **Prerequisite:** F1 complete

- [ ] **F3** — In-game video chat
  - **Task:** #651
  - **Approach:** Opt-in floating video tiles anchored near each `PlayerInfo`. Use same SDK as F2 (LiveKit recommended — supports audio + video). Camera permission required.
  - **Prerequisite:** F2 complete

---

## Strategic Recommendation: Fix Order vs. Feature Order

**Recommended sequence:**

```
C1 → C2 → C3 → C4    (1–2 days)   — stability must-haves
H1 → H2 → H3          (3–5 days)   — render/memory performance
                        ↓
                   Begin text chat (F1) design + implementation
                        ↓
H4 → H5 → M1–M4   (parallel, 1–2 weeks) — refactoring
                        ↓
                   Voice chat (F2) → Video chat (F3)
                        ↓
L1–L5              (ongoing polish)
```

**Why this order:**
- **C1 (OOM)** and **C2 (timer leak)** worsen with more concurrent features running. Fix first.
- **C3 (push notifications broken)** means players won't receive game invites — critical for social features.
- **H2 (React.memo)** — adding chat panels to an already re-render-heavy screen will cause severe jank without this.
- **H3 (InactivityCountdownRing RAF)** — adding video tiles to an app already doing RAF+setState every tick will drop frames.
- **Safe to start in parallel now:** Text chat design spec; WebRTC provider evaluation (Agora vs LiveKit vs Daily.co); microphone permission flow design.

---

*Last updated: March 2026 — Full codebase audit*
