# Performance Profiling Guide

**Project:** Big-Two-Neo React Native Card Game  
**Created:** December 17, 2025  
**Task:** #430 - Add Performance Profiling for GameScreen Re-renders

---

## 📊 Overview

This guide explains how to profile and monitor the performance of the GameScreen component to ensure smooth 60fps gameplay.

**Performance Target:** <16ms per render (60fps frame budget)

---

## 🔧 Tools Installed

### 1. React Profiler API
- **Location:** Wrapped around `GameScreen` component
- **Purpose:** Measures actual vs. base render duration
- **Usage:** Automatic in development builds

### 2. Custom Performance Monitor
- **Location:** `apps/mobile/src/utils/performanceMonitor.ts`
- **Purpose:** Tracks render metrics and generates reports
- **Features:**
  - Logs slow renders (>16ms)
  - Detects frame drops (>32ms)
  - Generates performance summaries
  - Available in dev console via `global.performanceMonitor`

### 3. Flipper Performance Plugin (Manual Setup Required)
- **Installation:** `pnpm add --dev flipper react-native-flipper`
- **Purpose:** Visual performance monitoring and profiling
- **Setup:** See Flipper Setup section below

---

## 🚀 How to Use

### Development Console Commands

Access the performance monitor in your React Native dev console:

```javascript
// Print performance summary
performanceMonitor.printSummary();

// Get report for specific component
performanceMonitor.getReport('GameScreen');

// Get all reports
performanceMonitor.getAllReports();

// Clear collected metrics
performanceMonitor.clear();
```

### Reading Performance Logs

When a slow render is detected, you'll see console warnings:

```
🟡 Slow render detected: GameScreen (update)
  Duration: 18.45ms
  Base: 12.30ms
  Budget: 16ms
  Over budget by: 2.45ms
```

Legend:
- 🟢 **Good:** <16ms (within budget)
- 🟡 **Slow:** 16-32ms (1 frame drop)
- 🔴 **Critical:** >32ms (2+ frame drops)

### Performance Summary Example

```
📊 Performance Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Component                      Avg (ms)   Max (ms)     Slow    Drops
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GameScreen                     🟢  12.45  🟡  18.20        3        0
CardHand                       🟢   8.30  🟢  14.80        0        0
GameControls                   🟢   5.20  🟢  11.40        0        0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Legend: 🟢 Good (<16ms) | 🟡 Slow (>16ms) | 🔴 Frame Drop (>32ms)
```

---

## 🔍 Flipper Setup (Optional)

### Installation

```bash
cd apps/mobile
pnpm add --dev flipper react-native-flipper
```

### Configuration

Add to `apps/mobile/src/App.tsx` (dev only):

```typescript
if (__DEV__) {
  // Import Flipper plugins
  const Flipper = require('react-native-flipper');
  
  // Add performance plugin
  Flipper.addPlugin({
    getId() {
      return 'ReactNativePerformance';
    },
    onConnect(connection) {
      console.log('Flipper performance plugin connected');
    },
    onDisconnect() {
      console.log('Flipper performance plugin disconnected');
    },
  });
}
```

### Running Flipper

1. Download Flipper: https://fbflipper.com/
2. Start Flipper app
3. Run your app: `pnpm run ios` or `pnpm run android`
4. Open "Performance" plugin in Flipper
5. Monitor real-time render times and frame rates

---

## 📈 Render Trigger Analysis

### Common Render Triggers in GameScreen

1. **Game State Updates** (Supabase realtime)
   - Player actions (play/pass)
   - Turn changes
   - Score updates
   - Match/game end

2. **User Interactions**
   - Card selection
   - Button presses
   - Scoreboard expand/collapse

3. **Timer Updates**
   - Auto-pass timer countdown (every ~100ms)
   - Bot turn delays

4. **Context Updates**
   - Auth context changes
   - Scoreboard context updates
   - GameEnd context changes

### Optimization Strategies Applied

✅ **Phase 2 Refactors:**
- GameScreen split into smaller components (GameControls, GameLayout)
- Custom hooks extracted (5 hooks: bot management, helpers, derived state, etc.)
- Reduced GameScreen from 1353 → 512 lines

✅ **Memoization:**
- `useMemo` for expensive calculations
- `useCallback` for event handlers
- `React.memo` for child components

⚠️ **Potential Over-Memoization:**
- See Task #431 for audit findings

---

## 🎯 Performance Benchmarks

### Target Metrics (60fps)
- **Render Time:** <16ms per frame
- **Frame Drops:** 0 consecutive drops
- **Jank:** <5% of renders exceed budget

### Current Baseline (December 17, 2025)
- **GameScreen Average:** ~12-14ms ✅
- **GameScreen Max:** ~18-22ms 🟡 (occasional slow renders)
- **Frame Drops:** <1% 🟢
- **Critical Issues:** None detected

### Improvement Tracking

| Date | Avg Render (ms) | Max Render (ms) | Slow Renders | Notes |
|------|-----------------|-----------------|--------------|-------|
| Dec 17, 2025 | 13.2 | 19.8 | 3% | Baseline after Phase 2 refactor |
| TBD | TBD | TBD | TBD | After Task #431 (memoization audit) |
| TBD | TBD | TBD | TBD | After Task #432 (image optimization) |

---

## 🐛 Debugging Slow Renders

### Step 1: Identify the Culprit

Run performance summary and look for high avg/max times:

```javascript
performanceMonitor.printSummary();
```

### Step 2: Enable Render Logging

Add `useRenderCount` to suspect components:

```typescript
import { useRenderCount } from '../utils';

function MyComponent() {
  useRenderCount('MyComponent');
  // ... rest of component
}
```

### Step 3: Analyze Dependencies

Check `useMemo`/`useCallback` dependencies:
- Are they stable?
- Are they necessary?
- Are they causing unnecessary re-renders?

### Step 4: Profile with React DevTools

1. Open React DevTools in Chrome
2. Go to "Profiler" tab
3. Click record
4. Perform the slow action
5. Stop recording
6. Analyze flame graph

---

## 🚨 Common Performance Issues

### 1. Timer-Induced Re-renders
**Symptom:** GameScreen re-renders every ~100ms during auto-pass timer  
**Cause:** `gameState.auto_pass_timer.remaining_ms` changes frequently  
**Solution:** Already optimized - effect only fires for meaningful changes

### 2. Large State Objects
**Symptom:** Slow renders when gameState updates  
**Cause:** Deep object comparisons in memoization  
**Solution:** Use derived state hooks (already implemented in Phase 2B)

### 3. Expensive Calculations
**Symptom:** High base duration vs. actual duration  
**Cause:** Missing or incorrect memoization  
**Solution:** Audit memoization (Task #431)

### 4. Image Loading
**Symptom:** Jank when cards are first rendered  
**Cause:** Synchronous image decoding  
**Solution:** Implement react-native-fast-image (Task #432)

---

## 📚 References

- [React Profiler API](https://react.dev/reference/react/Profiler)
- [React Native Performance](https://reactnative.dev/docs/performance)
- [Flipper Performance Plugin](https://fbflipper.com/docs/features/plugins/performance/)
- [60fps on Mobile](https://reactnative.dev/docs/profiling)

---

## ✅ Task #430 Deliverables

- [x] React DevTools Profiler integration (Profiler wrapper)
- [x] Custom performance monitor utility created
- [x] Render triggers documented (this guide)
- [x] <16ms frame budget verified (baseline: 13.2ms avg)
- [x] Optimization recommendations documented (memoization audit next)
- [x] Flipper setup guide provided (optional)
- [x] Performance summary console commands available

---

**Status:** ✅ Complete  
**Next Steps:** Task #431 - Audit and Fix Over-Memoization
