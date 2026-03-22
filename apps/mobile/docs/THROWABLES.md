# Throwables — GG Poker–Style Fun Projectiles

## Overview

Throwables let players toss fun items (🥚 Egg, 💨 Smoke, 🎊 Confetti) at opponents during **multiplayer** games. All players at the table see the animation. The targeted player also receives a full-screen popup that they must acknowledge.

---

## Feature Specification

### Throwable Types
| Emoji | Type | Splat | Theme Colour |
|-------|------|-------|--------------|
| 🥚 | `egg` | 🍳 | Amber `#FBBF24` particles |
| 💨 | `smoke` | 🌫️ | Grey `#9CA3AF` particles |
| 🎊 | `confetti` | ✨ | Multicolour `#EF4444` / `#3B82F6` / `#10B981` / `#F59E0B` / `#8B5CF6` particles |

### Flow
1. Player taps the **🎯 ThrowButton** (bottom-right, portrait mode).
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

**Positioning:** `bottom: 180, right: SPACING.sm` — right side, same height as Sort/Smart/Hint buttons.

#### `ThrowablePlayerEffect`
**File:** `src/components/game/ThrowablePlayerEffect.tsx`

Small overlay rendered on a PlayerInfo avatar tile (absolute-fill). Uses **fireworks-style radial burst** animation:
- Single `burstAnim` value drives 10 particles via `interpolate()`
- Particles distributed evenly at angles `i × (2π / 10)` radiating outward
- Distance varied: 18, 24, or 30 px alternating
- Splat emoji scales in 80ms after burst begins
- Container fades out at 3.2s, fully gone at ~3.7s (within 5s slot)
- `pointerEvents="none"` set as a **View prop** (not a StyleSheet property)

#### `ThrowableReceiverModal`
**File:** `src/components/game/ThrowableReceiverModal.tsx`

Full-screen transparent `Modal`. Shows big emoji → splat animation. Double-tap anywhere (or 5s auto-dismiss) closes it.

- Uses `useWindowDimensions()` hook (not `Dimensions.get('window')` at module load) so it responds correctly to orientation changes.

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

### Layout: `GameLayout`
**File:** `src/components/game/GameLayout.tsx`

Each `PlayerInfo` container that wraps the avatar tile is a valid positioned parent for `ThrowablePlayerEffect` (absolute fill). The top/left/right containers use their `position: 'absolute'` style directly — no `{ position: 'relative' }` override is needed or correct.

---

## Known Constraints / Future Work

- [ ] Landscape mode: `ThrowButton` positioning in landscape layout (currently only portrait has position defined)
- [ ] Rate limiting on the server side (current 30s cooldown is client-enforced only)
- [ ] Per-player cooldown shown to other players (they currently don't see the sender's cooldown state)
- [ ] Throwable history / log in the chat drawer

---

## Copilot PR Review Fixes (PR #172)

All 5 Copilot comments addressed:

| # | File | Issue | Fix |
|---|------|-------|-----|
| 1 | `ThrowablePlayerEffect.tsx` | `pointerEvents: 'none'` inside `StyleSheet.create()` — not a valid style prop | Removed from StyleSheet; added as `pointerEvents="none"` prop on `<Animated.View>` |
| 2 | `ThrowableReceiverModal.tsx` | `Dimensions.get('window')` at module load — doesn't respond to orientation changes | Replaced with `useWindowDimensions()` hook inside component body |
| 3 | `useThrowables.test.ts` | `afterEach` missing `jest.clearAllTimers()` — causes open-handle test flakiness | Added `jest.clearAllTimers()` before `jest.useRealTimers()` |
| 4 | `GameLayout.tsx` (left) | `{ position: 'relative' }` override on `leftPlayerContainer` broke bot layout | Removed inline override; container uses its `position: 'absolute'` style directly |
| 5 | `GameLayout.tsx` (right) | Same as #4 for `rightPlayerContainer` | Removed inline override |

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
- [x] `ThrowablePlayerEffect` — fireworks-style radial burst (10 particles, `interpolate()`)
- [x] `ThrowableReceiverModal` — full-screen popup, double-tap or 5s dismiss
- [x] `ThrowablePicker` — type selection sheet
- [x] `PlayerTargetPicker` — target opponent selection sheet (works for bots)

### Integration
- [x] `MultiplayerGame.tsx` — useThrowables wired, broadcast on Supabase channel
- [x] `LocalAIGame.tsx` — no-op stubs (throwables multiplayer-only)
- [x] `GameView.tsx` — ThrowButton (FAB) + ThrowablePicker + PlayerTargetPicker + ReceiverModal
- [x] `GameLayout.tsx` — ThrowablePlayerEffect overlays on all 4 player slots
- [x] `GameContext.tsx` — full throwable field set including cooldown
- [x] `index.ts` — all throwable components exported

### Quality
- [x] 10/10 unit tests passing (`useThrowables.test.ts`)
- [x] `jest.clearAllTimers()` in afterEach (prevents open-handle flakiness)
- [x] Bot layout fix (removed errant `{ position: 'relative' }`)
- [x] TypeScript: zero errors (`pnpm tsc --noEmit`)
- [x] `pointerEvents` correctly on View prop, not in StyleSheet
- [x] `useWindowDimensions()` for orientation-responsive modal
- [ ] Landscape layout: position ThrowButton in landscape mode
- [ ] Server-side cooldown enforcement (current: client-side only)
