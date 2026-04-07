# Throwables — GG Poker–Style Fun Projectiles

## Overview

Throwables let players toss fun items (🥚 Egg, 💨 Smoke, 🎊 Confetti) at opponents during **multiplayer** games. All players at the table see the animation. The targeted player also receives a full-screen popup that they must acknowledge.

Works in both **portrait** and **landscape** orientations — layouts and animations adapt automatically.

---

## Feature Specification

### Throwable Types

| Emoji | Type | Splat | Animation Style | Particle Colours |
|-------|------|-------|-----------------|-----------------|
| 🥚 | `egg` | 🍳 | Gravity-biased downward drip (yolk splatter) | Amber `#FBBF24` / `#FCD34D` / `#F59E0B` |
| 💨 | `smoke` | 🌫️ | Upward drift puff (cloud expand) | Grey `#9CA3AF` / `#D1D5DB` / `#6B7280` |
| 🎊 | `confetti` | ✨ | Full-circle burst of rectangular confetti pieces | Multicolour `#EF4444` / `#3B82F6` / `#10B981` / `#F59E0B` / `#8B5CF6` / `#EC4899` |

### Flow
1. Player taps the **🎯 ThrowButton**.
   - **Portrait**: bottom-right, same row as Sort/Smart/Hint (bottom: 180, right: 8).
   - **Landscape**: to the right of the **Smart** button in the top action-button row.
2. `ThrowablePicker` sheet appears — player selects a throwable type.
3. `PlayerTargetPicker` sheet appears — player selects a target (opponent or bot).
4. `sendThrowable(targetGameIndex, throwableType)` fires.
5. **Supabase Realtime broadcast** is sent to the room channel (`throwable_sent` event).
6. **Local echo** immediately enqueues the animation on the thrower's screen (Supabase does not echo broadcasts to the sender).
7. Every client that receives the broadcast enqueues the `ThrowablePlayerEffect` overlay on the target's avatar tile.
8. If the targeted client is a **human**, they also see the `ThrowableReceiverModal` full-screen popup.
9. After **5 seconds**, the avatar overlay and popup auto-dismiss.
10. The thrower enters a **30-second cooldown**; the 🎯 ThrowButton shows a spinner + countdown.

### Bots
- Bots can be targeted (the animation plays on their avatar tile for all players).
- No `ThrowableReceiverModal` is shown for bots (they have no screen).

---

## Animations

### `ThrowablePlayerEffect` — Avatar Tile Overlay

Each throwable type has a **distinct animation** tailored to its theme:

#### 🥚 Egg — Gravity Splat
- 12 amber particles biased toward the **lower hemisphere** (27°–153°), simulating gravity pulling yolk downward.
- 2 "sideways squirt" particles at ±30° for realism.
- `🍳` splat emoji scales in 60ms after burst begins with a spring bounce.
- Duration: 400ms burst.

#### 💨 Smoke — Rising Puff
- 10 grey particles aimed toward the **upper hemisphere** (−148°–(−32°)), simulating smoke rising.
- Larger circular particles (9–15px) that feel cloud-like.
- `🌫️` splat emoji scales in 200ms (slight delay for the "poof" effect).
- Duration: 600ms burst (slower = floatier).

#### 🎊 Confetti — Full Scatter
- 14 **rectangular** confetti pieces distributed evenly across the full 360°.
- Multicolour palette (7 colours cycling).
- `✨` sparkle emoji scales in immediately.
- Duration: 520ms burst.

#### Container Scaling (Portrait vs Landscape)
- The component uses `onLayout` to measure its container dimensions at runtime.
- All particle travel distances (`dist`) are calculated as `containerSize * 0.4–0.48`, so the burst always fills the tile proportionally — whether the player tile is a small 60×60 portrait chip or a larger 100×100 landscape rectangle.
- The splat emoji font size is also `containerSize * 0.38` (min 18px).

### `ThrowableReceiverModal` — Full-Screen Popup

- Uses `useWindowDimensions()` so the backdrop always fills the current orientation.
- `supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}` prevents iOS from crashing when the modal is presented in a multi-orientation app (SIGABRT / `UIViewController __supportedInterfaceOrientations`).
- Portrait: tall vertical layout, 80px main emoji.
- Landscape: the same layout naturally reflows; `flex: 1` on the backdrop keeps it full-screen.

---

## Crash Fix: `EXC_CRASH (SIGABRT)` — `__supportedInterfaceOrientations`

### Root Cause
When the app is configured with `orientation: "default"` (portrait + landscape) in `app.json`, iOS asks each `UIViewController` what orientations it supports when a modal is being presented. React Native's `Modal` component (via `RCTModalHostViewComponentView`) presents its own `UIViewController`. Without `supportedOrientations`, it defaults to portrait-only, causing a `UIKitCore` exception when the parent orientation context expects multi-orientation support.

Call stack:
```
UIViewController __supportedInterfaceOrientations
_UIFullscreenPresentationController _prepareForMixedOrientationTransitionIfNecessaryInWindow
RCTModalHostViewComponentView ensurePresentedOnlyIfNeeded
RNSScreen presentViewController:animated:completion:  ← react-native-screens
```

### Why Error Boundaries Didn't Catch It
React Error Boundaries only catch **JavaScript** render errors. This crash is a **native ObjC/UIKit exception** (`NSException` raised in UIKitCore), which happens entirely in the native layer — JS is never involved, so the boundary is never triggered.

### Fix Applied
Added `supportedOrientations` prop to the `Modal` in `ThrowableReceiverModal.tsx`:
```tsx
supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
```
This tells iOS the modal can appear in any orientation, matching the app-level orientation configuration.

---

## Architecture

### Hook: `useThrowables`
**File:** `src/hooks/useThrowables.ts`

Manages all throwable state. Used only in `MultiplayerGame.tsx`.

```
useThrowables({
  channel,        // Supabase Realtime channel
  userId,         // Local player's Supabase ID
  username,       // Local player's display name
  layoutPlayers,  // 4-slot display order from useMultiplayerLayout
  myPlayerIndex,  // Local player's game seat index
})
→ {
  activeEffects,          // (ActiveThrowableEffect | null)[] length 4
  incomingThrowable,      // IncomingThrowable | null
  dismissIncoming,        // () => void
  sendThrowable,          // (targetGameIndex, throwable) => void
  isThrowCooldown,        // boolean
  cooldownRemaining,      // number (seconds 0–30)
}
```

**Key internals:**
- `effectQueuesRef`: per-slot `ActiveThrowableEffect[][]` queue — simultaneous throwables play sequentially
- `slotActiveIdRef`: tracks which effect ID is currently showing per slot
- `startNextRef`: stable recursive ref that dequeues and shows the next effect for a slot
- `isCooldownActiveRef`: ref-based guard prevents double-throws during the same event loop tick
- `startCooldown()`: sets a 500ms `setInterval` counting down `cooldownRemaining` from 30→0

### Components

#### `ThrowButton`
**File:** `src/components/game/ThrowButton.tsx`

Standalone floating action button. Shows 🎯 emoji normally; during cooldown shows `ActivityIndicator` + `{N}s` text.

**Props:** `{ onPress, isThrowCooldown, cooldownRemaining, isDisabled? }`

**Portrait positioning:** `bottom: 180, right: SPACING.sm` — right side, same height as Sort/Smart/Hint buttons.

**Landscape positioning:** Rendered inline to the right of the **Smart** button in `LandscapeGameLayout`'s top action button row (Play | Smart | 🎯).

#### `ThrowablePlayerEffect`
**File:** `src/components/game/ThrowablePlayerEffect.tsx`

Small overlay rendered on a PlayerInfo avatar tile (absolute-fill). Uses `onLayout` for container-aware sizing so animations look correct in both portrait and landscape tiles.

**Per-type animation design:**
- 🥚 Egg: gravity-biased downward splat (12 amber particles, lower hemisphere)
- 💨 Smoke: upward drift puff (10 grey particles, upper hemisphere, 600ms)
- 🎊 Confetti: full-circle scatter (14 rectangular multicolour pieces, 520ms)

`pointerEvents="none"` set as a **View prop** (not a StyleSheet property).

#### `ThrowableReceiverModal`
**File:** `src/components/game/ThrowableReceiverModal.tsx`

Full-screen transparent `Modal`. Shows big emoji → splat animation. Double-tap anywhere (or 5s auto-dismiss) closes it.

- Uses `useWindowDimensions()` hook for orientation-responsive sizing.
- `supportedOrientations` covers all orientations (crash fix).

#### `ThrowablePicker`
**File:** `src/components/game/ThrowablePicker.tsx`

Bottom sheet for selecting the throwable type (egg / smoke / confetti).

#### `PlayerTargetPicker`
**File:** `src/components/game/PlayerTargetPicker.tsx`

Bottom sheet for selecting the target opponent. Filters to non-local players. Works for bots too.

### Context: `GameContext`
**File:** `src/contexts/GameContext.tsx`

Throwable fields:
```typescript
throwableActiveEffects: readonly (ActiveThrowableEffect | null)[];
throwableIncoming: IncomingThrowable | null;
throwableDismissIncoming: () => void;
sendThrowable: (targetGameIndex: number, throwable: ThrowableType) => void;
isThrowCooldown: boolean;
cooldownRemaining: number;
```

`LocalAIGame.tsx` provides no-op stubs (`isThrowCooldown: false, cooldownRemaining: 0`). Throwables are multiplayer-only.

### Layout: `GameLayout` (Portrait)
**File:** `src/components/game/GameLayout.tsx`

Each `PlayerInfo` container that wraps the avatar tile is a valid positioned parent for `ThrowablePlayerEffect` (absolute fill). Uses its `position: 'absolute'` style directly — no `{ position: 'relative' }` override.

### Layout: `LandscapeGameLayout`
**File:** `src/components/gameRoom/LandscapeGameLayout.tsx`

Added props: `onThrowPress?`, `isThrowCooldown?`, `cooldownRemaining?`

`ThrowButton` renders inline in the top button row (Play | Smart | 🎯) when `onThrowPress` is provided.

---

## Known Constraints / Future Work

- [ ] Server-side cooldown enforcement (current 30s cooldown is client-enforced only)
- [ ] Per-player cooldown shown to other players (they currently don't see the sender's cooldown state)
- [ ] Throwable history / log in the chat drawer

---

## Copilot PR Review Fixes (PR #172)

All Copilot comments addressed across review rounds:

| Round | File | Issue | Fix |
|-------|------|-------|-----|
| v1 | `ThrowablePlayerEffect.tsx` | `pointerEvents: 'none'` inside `StyleSheet.create()` | Removed from StyleSheet; added as `pointerEvents="none"` prop on `<Animated.View>` |
| v1 | `ThrowableReceiverModal.tsx` | `Dimensions.get('window')` at module load — orientation-unresponsive | Replaced with `useWindowDimensions()` hook inside component body |
| v1 | `useThrowables.test.ts` | `afterEach` missing `jest.clearAllTimers()` | Added before `jest.useRealTimers()` |
| v1 | `GameLayout.tsx` (left) | `{ position: 'relative' }` override on `leftPlayerContainer` | Removed inline override |
| v1 | `GameLayout.tsx` (right) | Same for `rightPlayerContainer` | Removed inline override |
| v2 | `security_hardening.sql` | PR description didn't mention security migrations | Updated PR description with full migration table |
| v3 | `GameLayout.tsx` (top) | Redundant `{ position: 'relative' }` on `topPlayerAboveTable` | Removed inline override |

---

## Implementation Checklist

### Core Infrastructure
- [x] `useThrowables` hook — Supabase broadcast send/receive
- [x] `ActiveThrowableEffect` / `IncomingThrowable` types
- [x] `ThrowableType` (`'egg' | 'smoke' | 'confetti'`) in multiplayer types
- [x] Per-slot **queue system** for simultaneous throwables
- [x] **Local echo** — thrower sees effect immediately (Supabase doesn't echo to sender)
- [x] **30-second cooldown** with real-time countdown
- [x] `isThrowCooldown` + `cooldownRemaining` in `GameContext`

### UI Components
- [x] `ThrowButton` — standalone FAB with spinner + countdown during cooldown
- [x] `ThrowablePlayerEffect` — per-type animations (egg drip / smoke puff / confetti burst)
- [x] `ThrowablePlayerEffect` — container-aware sizing via `onLayout` (portrait + landscape)
- [x] `ThrowableReceiverModal` — full-screen popup, double-tap or 5s dismiss
- [x] `ThrowableReceiverModal` — `supportedOrientations` crash fix for iOS
- [x] `ThrowablePicker` — type selection sheet
- [x] `PlayerTargetPicker` — target opponent selection sheet (works for bots)

### Integration
- [x] `MultiplayerGame.tsx` — useThrowables wired, broadcast on Supabase channel
- [x] `LocalAIGame.tsx` — no-op stubs (throwables multiplayer-only)
- [x] `GameView.tsx` — ThrowButton (portrait FAB) + ThrowablePicker + PlayerTargetPicker + ReceiverModal
- [x] `GameView.tsx` — passes ThrowButton props to `LandscapeGameLayout`
- [x] `LandscapeGameLayout.tsx` — ThrowButton inline right of Smart button
- [x] `GameLayout.tsx` — ThrowablePlayerEffect overlays on all 4 player slots
- [x] `GameContext.tsx` — full throwable field set including cooldown
- [x] `index.ts` — all throwable components exported

### Quality
- [x] 10/10 unit tests passing (`useThrowables.test.ts`)
- [x] `jest.clearAllTimers()` in afterEach (prevents open-handle flakiness)
- [x] Bot layout fix (removed errant `{ position: 'relative' }` overrides)
- [x] TypeScript: zero errors (`pnpm tsc --noEmit`)
- [x] `pointerEvents` correctly on View prop, not in StyleSheet
- [x] `useWindowDimensions()` for orientation-responsive modal
- [x] `supportedOrientations` on Modal — fixes SIGABRT / `__supportedInterfaceOrientations` crash
- [x] `onLayout` container measurement for proportional animations in portrait + landscape
- [ ] Server-side cooldown enforcement (current: client-side only)

