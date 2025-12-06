# Package Version Pinning Documentation

This document explains why certain packages are pinned to specific versions in `package.json`.

## react-native-reanimated: ^4.1.6

**Why pinned:** Compatibility with gesture handling fixes. Version 4.2.0 introduced breaking changes with gesture integration.

**Key features verified working:**
- `Gesture.Race()` API for simultaneous tap/pan gestures
- `runOnJS()` worklet functionality for UI thread → JS thread communication
- Proper worklet directive support

**Related documentation:** See `TASK_264_CARD_SELECTION_CRASH_FIX.md` for details on the card selection crash fix that required this version.

---

## react-native-worklets: ^0.5.1

**Why pinned:** Compatibility with react-native-reanimated 4.1.6. Version 0.7.0 requires reanimated 4.2.0+.

**Key features verified working:**
- All required worklet functionality for gesture-based animations
- Stable integration with reanimated 4.1.6

**Related packages:** Must stay in sync with react-native-reanimated version.

---

## Update Policy

These versions should **not** be upgraded until:
1. Testing confirms the new versions work with our gesture handling code
2. The card selection crash fix (Gesture.Race + runOnJS pattern) is verified in new versions
3. All integration tests pass with new versions

To test upgrades safely:
1. Create a new branch
2. Upgrade packages
3. Run full test suite: `pnpm test`
4. Manually test card selection gestures (tap, drag, multi-select)
5. Monitor for crashes or gesture conflicts
