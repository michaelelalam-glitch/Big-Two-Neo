# Big-Two-Neo — Full Application Audit Report

**Date:** March 2026  
**Project:** Big-Two-Neo (Big2 Mobile App)  
**Platform:** React Native 0.81.5 / Expo ~54.0.29 / TypeScript ~5.9.2  
**Branch:** `game/chinese-poker`  
**Codebase size:** ~43,700 LOC source, 67 test files, 128 Supabase migrations, 16 edge functions  

---

## Table of Contents

1. [Architecture & Code Quality](#1-architecture--code-quality)
2. [Performance](#2-performance)
3. [UI/UX](#3-uiux)
4. [Functionality & Correctness](#4-functionality--correctness)
5. [Best Practices & Maintainability](#5-best-practices--maintainability)
6. [Dependencies & Project Health](#6-dependencies--project-health)
7. [Prioritised Fix List](#7-prioritised-fix-list)
8. [Feature Backlog](#8-feature-backlog)
9. [Scaling Roadmap](#9-scaling-roadmap)

---

## 1. Architecture & Code Quality

### Overview

The app follows a layered architecture: screens → hooks → game engine → Supabase services. The game logic layer (`src/game/engine/game-logic.ts`) is well-isolated and pure, making it the healthiest part of the codebase. However, several screens and hooks have grown into monoliths that violate single-responsibility.

### Key Files by Size

| File | LOC | Status |
|------|-----|--------|
| `src/i18n/index.ts` | 2,399 | Acceptable (string data) |
| `src/screens/HomeScreen.tsx` | 1,643 | ⚠️ Monolithic |
| `src/components/gameEnd/GameEndModal.tsx` | 1,512 | ⚠️ Large |
| `src/game/state.ts` | 1,425 | 🔴 Critical bugs |
| `src/screens/StatsScreen.tsx` | 1,411 | ⚠️ Large |
| `src/screens/LobbyScreen.tsx` | 1,170 | ⚠️ Large |
| `src/screens/MultiplayerGame.tsx` | 1,029 | 🔴 Implicit state machine |
| `src/hooks/useRealtime.ts` | 704 | ⚠️ Complex |
| `src/game/engine/game-logic.ts` | 574 | ✅ Clean (pure functions) |
| `src/components/game/CardHand.tsx` | 524 | ⚠️ Moderate |

### Architecture Concerns

#### A1 — `MultiplayerGame.tsx`: Implicit Disconnect State Machine
**File:** `src/screens/MultiplayerGame.tsx`  
**Lines:** 580–842  

The component orchestrates all multiplayer game logic: 19 custom hooks, 8 `useState`, 10 `useRef`, and 12 `useEffect` hooks. The most critical issue is a **263-line `useEffect`** (lines 580–842) that implements a 6-state disconnect detection machine using deeply nested conditionals. This is an implicit state machine that is nearly impossible to reason about, test, or extend.

The component also passes **50+ props** directly to `GameView`, creating massive prop drilling. Refs like `lastTurnStartedAtRef`, `localPlayerWasActiveRef`, `clientDisconnectStartRef`, and `sweepRetryTimeoutRef` suggest stateful logic that belongs in a dedicated hook or state machine (XState or a reducer).

**Recommendation:** Extract the disconnect logic into a `useDisconnectStateMachine` hook with explicit states: `connected → timeout_pending → confirming → disconnected → recovering`. Use `useReducer` to manage state transitions.

#### A2 — `HomeScreen.tsx`: Mixed Responsibilities
**File:** `src/screens/HomeScreen.tsx` (1,643 LOC)  

Handles UI rendering, matchmaking RPC calls, room cleanup, a recursive `setTimeout` polling loop (1s recheck), and AsyncStorage persistence (`VOLUNTARILY_LEFT_ROOMS_KEY`). This makes it extremely difficult to test or refactor individual concerns.

**Recommendation:** Extract into: `useMatchmakingFlow`, `useRoomCleanup`, `<MatchmakingPanel />`, and keep `HomeScreen` as a thin coordinator (~200 LOC).

#### A3 — `GameView.tsx`: Prop Explosion
**File:** `src/screens/GameView.tsx`  

Receives 50+ props passed through from `MultiplayerGame.tsx`. Most are forwarded unmodified to nested components. This is a symptom of missing shared context.

**Recommendation:** Consolidate game UI state into a `GameContext` or expand the Zustand store. `GameView` should subscribe to context rather than accept 50 individual props.

---

## 2. Performance

### P1 — `InactivityCountdownRing`: JS-Thread Animation
**File:** `src/components/game/InactivityCountdownRing.tsx`  

Uses `requestAnimationFrame` + React `setState` at ~15fps. Every animation tick causes a JS-thread re-render, which competes with game logic processing during active turns. On a mid-range Android device, this can cause visible jank.

**Fix:** Replace with `useSharedValue` + `useDerivedValue` from `react-native-reanimated`. The ring progress and color interpolation can run entirely on the UI thread.

### P2 — `GameView` Missing `React.memo`
**File:** `src/screens/GameView.tsx`  

`GameView` is not wrapped in `React.memo`. Because `MultiplayerGame` has frequent heartbeat ticks and realtime subscription callbacks, `GameView` re-renders on every parent update — even when none of its 50+ props have changed.

**Fix:** `export default React.memo(GameView)` + move callback definitions to `useCallback` in the parent.

### P3 — `useMultiplayerLayout`: O(4N) `.find()` Per Render
**File:** `src/hooks/useMultiplayerLayout.ts`  

Performs 4 consecutive `.find()` calls on the players array per render. With 4 players this is negligible, but combined with frequent realtime renders the overhead accumulates.

**Fix:** Build a `Map<string, Player>` keyed by player ID once in a `useMemo`, then do O(1) lookups.

---

## 3. UI/UX

### U1 — Card Touch Targets Below iOS HIG Minimum
**File:** `src/components/game/Card.tsx`, `src/utils/cardOverlap.ts`  

At 70%+ card overlap in portrait mode, the visible card width is ~20–22px — well below the iOS HIG 44px minimum touch target. Players with larger fingers will frequently mis-tap adjacent cards.

**Fix Options:**
- Add `hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}` to the card gesture handler (quick)
- Reduce overlap percentage on portrait screens via `cardOverlap.ts`
- Implement fan arc layout that fans upward on long-press (best UX)

**Evaluate on:** iPhone SE (320px wide screen).

### U2 — Accessibility: No VoiceOver Support
**Files:** `src/components/game/Card.tsx`, `src/components/game/GameControls.tsx`  

Cards have no `accessibilityLabel`, `accessibilityRole`, or `accessibilityState`. The play/pass button has no announcement when a turn begins. VoiceOver users cannot play the game.

**Fix:** Add `accessibilityLabel`, `accessibilityHint`, `accessibilityRole="button"`, and `accessibilityState={{ selected: isSelected }}` to `Card`. Add `AccessibilityInfo.announceForAccessibility("Your turn")` in `GameControls` when the local player's turn begins.

### U3 — Dead Code in `GameView`
**File:** `src/screens/GameView.tsx`  

`{false && <SpectatorBanner />}` — the spectator banner is permanently hidden. If spectator mode is not planned, remove `SpectatorBanner` entirely.

---

## 4. Functionality & Correctness

### F1 — Unbounded Array Growth (Memory Risk)
**File:** `src/game/state.ts`  

`gameRoundHistory` and `played_cards` arrays accumulate entries across the entire session and are **never cleared** between rounds. Over 50+ matches (~typical session), these arrays can hold thousands of entries, pushing the JS heap toward OOM on devices with 2GB RAM.

**Fix:**
```typescript
// In GameStateManager.reset() or after each round end:
this.gameRoundHistory = this.gameRoundHistory.slice(-10); // keep last 10 rounds
this.played_cards = []; // clear on round end
```

### F2 — `setInterval` Timer Leak
**File:** `src/game/state.ts`  

`startTimerCountdown()` sets a 100ms `setInterval`. If `destroy()` is not called on component unmount (e.g., due to a navigation race), the interval runs forever, executing callbacks against stale state and draining the battery.

**Fix:**
```typescript
// In the component that owns GameStateManager:
useEffect(() => {
  const manager = new GameStateManager(...);
  return () => manager.destroy(); // guaranteed cleanup
}, []);
```

Also audit all `setInterval`/`setTimeout` usages across the codebase for missing cleanup.

### F3 — Push Notification Edge Function Broken
**File:** `supabase/functions/send-push-notification/index.ts` (~line 67)  

`SyntaxError: Identifier 'now' has already been declared` — the function crashes at deploy-time. No push notifications are sent for game invites, turn reminders, or match results.

**Fix:** Rename the duplicate `now` declaration or use `const` block scoping to eliminate the conflict.

### F4 — Matchmaking Race Condition
**File:** `src/hooks/useMatchmaking.ts`  

Both a 1-second polling interval (`setTimeout` recursion) and a Supabase Realtime subscription listen for room state changes. If both fire simultaneously (common on flaky 4G), both handlers attempt to transition the matchmaking state, potentially duplicating "start game" actions.

**Fix:** Use Realtime as the single source of truth; remove the recursive polling fallback. If Realtime is unreliable in your tests, add a debounce guard on the transition function.

---

## 5. Best Practices & Maintainability

### B1 — 10 `.bak` Files Committed to Version Control

`.bak` files are backup snapshots created during development. They are checked into git, bloating the repository and confusing developers about which files are canonical.

**Files to delete:**
```
src/screens/GameScreen.tsx.bak
src/components/game/CardHand.tsx.bak
src/components/game/GameControls.tsx.bak
src/components/gameEnd/GameEndModal.tsx.bak
src/hooks/useMatchmaking.ts.bak
src/hooks/useRealtime.ts.bak
src/hooks/useGameStateManager.ts.bak
src/hooks/useConnectionManager.ts.bak
src/hooks/usePlayHistoryTracking.ts.bak
src/hooks/__tests__/useRealtime-timer-cancellation.test.ts.bak
```

**Command:**
```bash
git rm src/**/*.bak
git commit -m "chore: remove .bak backup files from version control"
echo "*.bak" >> .gitignore
```

### B2 — 18 Root-Level Scripts
**Location:** `/apps/mobile/*.mjs` and `/apps/mobile/*.sh`  

18 migration and diagnostic scripts are scattered at the project root. They make the root messy and increase onboarding friction.

**Fix:** Move all to `scripts/` subdirectory and add a `scripts/README.md` documenting each script's purpose.

### B3 — No Error Boundaries
**Files:** `src/navigation/AppNavigator.tsx`, `src/screens/MultiplayerGame.tsx`  

Any unhandled JS exception inside the game screen will crash the entire app with a blank white screen. There are no React Error Boundaries.

**Fix:**
```tsx
// src/components/ErrorBoundary.tsx
class GameErrorBoundary extends React.Component {
  componentDidCatch(error, info) { /* log to Sentry/LogRocket */ }
  render() {
    if (this.state.hasError) return <ErrorFallbackScreen onRetry={this.reset} />;
    return this.props.children;
  }
}
// Wrap in AppNavigator around game screen stack
```

### B4 — Zustand Store Underutilized
**File:** `src/store/index.ts`  

The Zustand store exists but most cross-component state travels via React context or prop drilling. Adding chat/video panels will worsen this unless the store is expanded.

**Recommendation:** Migrate: auth state, current room, active game state, and UI preferences into Zustand slices.

### B5 — 128 Supabase Migrations
**Location:** `supabase/migrations/`  

128 discrete migration files make local DB reset and CI provisioning slow. Old migrations reference tables that no longer exist.

**Fix:** Squash all migrations into a single `baseline.sql` snapshot once the schema is stable. Keep only new migrations going forward.

---

## 6. Dependencies & Project Health

### D1 — Unused Dependencies (confirmed via depcheck)

| Package | Status |
|---------|--------|
| `expo-build-properties` | Possibly used in `app.json` plugins — verify |
| `expo-dev-client` | Unused in source — remove if not needed |
| `expo-linear-gradient` | Confirmed unused — remove |
| `react-native-screens` | Possibly used by React Navigation — verify before removing |

**To remove confirmed unused:**
```bash
pnpm remove expo-linear-gradient
```

### D2 — Missing ESLint Peer Dependencies

`depcheck` reports ESLint peer dependencies are missing from `devDependencies`. This causes ESLint to fail silently or use mismatched plugin versions.

**Fix:**
```bash
pnpm add -D eslint-plugin-react-hooks eslint-plugin-react-native
```

### D3 — Deep Linking Not Configured
**File:** `src/navigation/AppNavigator.tsx`  

No `linking` configuration is passed to `NavigationContainer`. Room codes cannot be shared as deep links (e.g., `bigtwo://room/ABC123`), which is a significant social feature gap.

**Fix:** Add an `expo-linking` configuration and register a URL scheme in `app.json`.

---

## 7. Prioritised Fix List

> Ordered by severity and recommended implementation sequence.

### 🔴 Critical (fix before any new features)

| ID | Issue | File | Task ID |
|----|-------|------|---------|
| C1 | Unbounded `gameRoundHistory`/`played_cards` — OOM risk | `game/state.ts` | #629 |
| C2 | `setInterval(100ms)` timer leak on unmount | `game/state.ts` | #630 |
| C3 | `SyntaxError: 'now' redeclared` — push notifications broken | `send-push-notification/index.ts` | #632 |
| C4 | 10 `.bak` files in version control | Multiple | #631 |

### 🟠 High Priority (fix before adding social features)

| ID | Issue | File | Task ID |
|----|-------|------|---------|
| H1 | 263-line implicit disconnect state machine `useEffect` | `MultiplayerGame.tsx` L580–842 | #633 |
| H2 | `GameView` not wrapped in `React.memo` | `GameView.tsx` | #635 |
| H3 | `InactivityCountdownRing` uses RAF+setState (JS thread) | `InactivityCountdownRing.tsx` | #634 |
| H4 | 50+ prop drilling into `GameView` | `GameView.tsx`, `MultiplayerGame.tsx` | #638 |
| H5 | `HomeScreen.tsx` 1,643 LOC mixed responsibilities | `HomeScreen.tsx` | #637 |

### 🟡 Medium Priority

| ID | Issue | File | Task ID |
|----|-------|------|---------|
| M1 | 18 root scripts not in `scripts/` directory | Root | #636 |
| M2 | 128 Supabase migrations — needs baseline squash | `supabase/migrations/` | #640 |
| M3 | Matchmaking race condition (polling + Realtime) | `useMatchmaking.ts` | #641 |
| M4 | O(4N) `.find()` lookups in `useMultiplayerLayout` | `useMultiplayerLayout.ts` | #639 |
| M5 | Missing ESLint peer dependencies | `package.json` | #642 |
| M6 | `expo-linear-gradient` unused | `package.json` | #644 |

### 🟢 Low Priority

| ID | Issue | File | Task ID |
|----|-------|------|---------|
| L1 | No Error Boundaries around game screens | `AppNavigator.tsx` | #643 |
| L2 | No VoiceOver/accessibility for cards and turns | `Card.tsx`, `GameControls.tsx` | #645 |
| L3 | No deep linking for room codes | `AppNavigator.tsx` | #646 |
| L4 | Zustand store underutilized | `store/index.ts` | #647 |
| L5 | Card touch targets ~22px (below iOS HIG 44px) | `Card.tsx`, `cardOverlap.ts` | #650 |

---

## 8. Feature Backlog

| ID | Feature | Priority | Prerequisite | Task ID |
|----|---------|----------|--------------|---------|
| F1 | In-game text chat | Medium | C1–H2 complete | #648 |
| F2 | In-game voice chat | Medium | F1 complete | #649 |
| F3 | In-game video chat | Low | F2 complete | #651 |

---

## 9. Scaling Roadmap

### Phase 1 — Stability (1–2 weeks)
Fix C1–C4 and H1–H3. This eliminates memory leaks, the broken push notification function, timer bugs, and the most render-performance regressions. After this phase, the app is stable enough to handle social features without increased memory pressure.

### Phase 2 — Refactoring (2–3 weeks)
Address H4–H5, M1–M4. Split `HomeScreen`, reduce prop drilling via `GameContext`, squash migrations, and move scripts. This is housekeeping that makes future development faster.

### Phase 3 — Social Layer (3–6 weeks)
Build text chat (#648) → voice chat (#649) → video chat (#651). Text chat is lowest risk (pure Supabase Realtime, no new native permissions). Voice and video require WebRTC SDK integration (recommended: **LiveKit** — open-source, React Native SDK maintained).

### Phase 4 — Polish (ongoing)
L1–L5, accessibility, deep linking, performance profiling on low-end Android (Pixel 4a or equivalent).

---

*Generated during full codebase audit — March 2026*
