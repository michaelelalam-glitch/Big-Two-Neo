# Reanimated Crash Analysis (EXC_BAD_ACCESS in ShadowTreeCloner)

## Crash Summary

**Error:** `EXC_BAD_ACCESS` in `ShadowTreeCloner.cpp` (lines 56/61)
**Library:** `react-native-reanimated` v4.1.6
**Platforms affected:** iOS (primarily), Android (occasionally)
**Frequency:** Intermittent — occurs during rapid screen transitions or when multiple animations run concurrently

## Root Cause

The crash occurs in Reanimated's C++ shadow tree cloning logic, which runs on the UI thread. `ShadowTreeCloner::clone()` recursively clones React Native's shadow nodes to apply animated style updates. The `EXC_BAD_ACCESS` (segfault) happens when:

1. **A shadow node is deallocated** while the cloner still holds a raw pointer to it
2. **The React tree unmounts** a component (e.g., during screen navigation) while a Reanimated animation is mid-frame
3. **Race condition** between the JS thread (which triggers tree mutations/unmounts) and the UI thread (which clones the tree for animation)

This is a known class of bugs in Reanimated v3/v4 when animations are active on components that unmount during navigation transitions. The recursive cloning in `ShadowTreeCloner.cpp:56/61` dereferences stale pointers to nodes that React Fabric has already freed.

## Components Using Reanimated in This App

| Component | Reanimated API | Risk Level |
|-----------|---------------|------------|
| `InactivityCountdownRing` | `useSharedValue`, `withTiming`, `Animated.createAnimatedComponent(Circle)` | **HIGH** — active during game, unmounts on navigation |
| `GameView` (hint pulse) | `Animated.loop`, `Animated.timing` (RN Animated, not Reanimated) | LOW — uses core RN Animated API |
| `ConnectionStatusIndicator` | `Animated.loop`, `Animated.timing` (RN Animated) | LOW — uses core RN Animated API |

**Primary suspect: `InactivityCountdownRing`** — this is the only component using the Reanimated v4 API (`useSharedValue`, `withTiming`). It has a `withTiming` animation running on the UI thread that triggers `runOnJS` on completion. If the component unmounts mid-animation (e.g., player leaves game), the shadow tree clone can reference a freed node.

## Mitigation Strategies

### 1. Cancel animations on unmount (RECOMMENDED — Low risk)
Add `cancelAnimation(progress)` in the cleanup of the scheduling `useEffect` in `InactivityCountdownRing`:

```tsx
useEffect(() => {
  // ... existing scheduling logic ...
  return () => {
    cancelAnimation(progress);
  };
}, [/* deps */]);
```

This ensures no stale `withTiming` callback fires after unmount.

### 2. Guard `runOnJS` callbacks with a mounted ref
The `onExpiredHandler` uses `runOnJS` which can fire after unmount. Add an `isMountedRef`:

```tsx
const isMountedRef = useRef(true);
useEffect(() => () => { isMountedRef.current = false; }, []);

const onTimerComplete = useCallback(() => {
  if (!isMountedRef.current) return;
  // ... existing logic ...
}, []);
```

### 3. Upgrade react-native-reanimated
Check for patches in versions > 4.1.6 that address `ShadowTreeCloner` crashes. Known fixes:
- [reanimated#6362](https://github.com/software-mansion/react-native-reanimated/issues/6362) — Shadow tree race condition
- [reanimated#5765](https://github.com/software-mansion/react-native-reanimated/issues/5765) — EXC_BAD_ACCESS during unmount

### 4. Defer navigation until animation cancels
When leaving the game screen, cancel all Reanimated animations before `navigation.reset()`:

```tsx
// In MultiplayerGame.tsx or wherever navigation happens
cancelAnimation(someSharedValue);
requestAnimationFrame(() => navigation.reset(...));
```

## Recommended Action Plan

1. **Immediate:** Apply mitigation #1 (cancelAnimation on unmount) — lowest risk, addresses the primary crash vector
2. **Short-term:** Apply mitigation #2 (mounted ref guard) — prevents any post-unmount JS callbacks
3. **Medium-term:** Upgrade reanimated to latest patch version and verify fix
4. **Monitor:** Track crash reports post-fix to confirm resolution

## Reproduction Steps (Approximate)

1. Join a multiplayer game where turn timer is active (InactivityCountdownRing visible)
2. While timer is counting down, rapidly leave the game (close room, disconnect, or navigate away)
3. The crash occurs ~10-20% of the time when the `withTiming` animation is mid-frame during unmount

## Related Files

- `apps/mobile/src/components/game/InactivityCountdownRing.tsx` — Primary crash site
- `apps/mobile/src/screens/MultiplayerGame.tsx` — Navigation triggers that cause unmount
- `apps/mobile/src/screens/GameView.tsx` — Parent game view (uses RN Animated, not Reanimated)
