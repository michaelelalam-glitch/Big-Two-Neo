# Game End RN Manual Testing Guide - Android

## Android Manual Testing Checklist (Task #399)

**Devices to Test:**
- Pixel 5 (mid-range, Android 11+)
- Galaxy S23 (flagship, Android 13+)
- Any device with API 28 (Android 9) - minimum supported

---

### Test 1: Modal Display & Animation

**Steps:**
1. Start a game with 4 players
2. Play until one player reaches 101+ points
3. Observe game end modal appearance

**Expected Results:**
- ✅ Modal springs in with smooth animation (friction: 8, tension: 40)
- ✅ Fireworks animation plays behind modal (5 seconds)
- ✅ Winner announcement displays with pulsing animation
- ✅ Trophy emoji 🏆 displays correctly (check font support)
- ✅ Modal is centered on screen
- ✅ Backdrop is semi-transparent (85% opacity)
- ✅ Elevation shadow displays correctly (elevation: 10)

**Device-Specific:**
- Pixel 5: Check gesture navigation bar clearance
- Galaxy S23: Verify edge-to-edge display
- API 28: Confirm emoji support (may need fallback)

---

### Test 2: Responsive Sizing

**Steps:**
1. Open game end modal in portrait mode
2. Rotate device to landscape
3. Rotate back to portrait

**Expected Results:**
- ✅ Portrait: Modal is 90% width, 85% max height
- ✅ Landscape: Modal is 70% width, 95% max height
- ✅ Rotation is smooth, no flickering
- ✅ Content reflows correctly
- ✅ Tab indicator adjusts width dynamically
- ✅ All touch targets remain ≥48dp (Android guideline)

**Device-Specific:**
- Small screens: Verify landscape mode doesn't cut off content
- Large screens: Modal max width 600px applies

---

### Test 3: Safe Area Handling

**Steps:**
1. Open modal on device with gesture navigation
2. Check all edges of modal
3. Test in both portrait and landscape

**Expected Results:**
- ✅ Content doesn't overlap navigation bar
- ✅ Content doesn't overlap status bar
- ✅ Landscape: Content respects side bezels
- ✅ SafeAreaView edges: ['top', 'bottom', 'left', 'right']

**Device-Specific:**
- Gesture navigation: Bottom inset handled correctly
- Button navigation: No interference with back button

---

### Test 4: Final Standings

**Steps:**
1. View Final Standings section
2. Verify player order and colors
3. Check medal emojis render correctly

**Expected Results:**
- ✅ Players sorted by score (lowest to highest)
- ✅ 1st place: 🥇 Gold medal (check emoji rendering)
- ✅ 2nd place: 🥈 Silver medal
- ✅ 3rd place: 🥉 Bronze medal
- ✅ Winner: Green text (#4ade80)
- ✅ Busted (>100pts): Red text (#f87171)
- ✅ Others: White text (#f3f4f6)

**Android-Specific:**
- Verify emoji rendering on older Android versions
- Check color rendering on AMOLED displays

---

### Test 5: Tab Switching

**Steps:**
1. Tap "Score History" tab (default)
2. Tap "Play History" tab
3. Tap back to "Score History"
4. Rapidly switch between tabs

**Expected Results:**
- ✅ Haptic feedback on each tap (medium impact)
  - Note: May not work on all Android devices
- ✅ Tab content fades out (150ms) → switches → fades in (150ms)
- ✅ Tab indicator slides smoothly (300ms)
- ✅ Active tab has blue highlight (rgba(59, 130, 246, 0.3))
- ✅ No flicker or visual glitches
- ✅ Rapid tapping doesn't break animation

**Android-Specific:**
- Some devices don't support haptics (should fail gracefully)
- Check animation performance on mid-range devices

---

### Test 6: Score History Tab

**Steps:**
1. Switch to Score History tab
2. Scroll through match history
3. Identify busted players and latest match

**Expected Results:**
- ✅ Match-by-match scores display correctly
- ✅ Points added per match shown (+15, +25, etc.)
- ✅ Latest match has blue accent border
- ✅ Busted players (>100pts) have red highlighting
- ✅ Footer shows total match count
- ✅ Empty state if no history (with icon and message)
- ✅ Scrolling is smooth (60fps on most devices)

**Android-Specific:**
- Check ScrollView performance on older devices
- Verify touch scrolling is responsive

---

### Test 7: Play History Tab

**Steps:**
1. Switch to Play History tab
2. Tap to expand a match
3. Tap to collapse the match
4. View cards played in each hand

**Expected Results:**
- ✅ Matches are collapsible (tap to expand/collapse)
- ✅ Latest match highlighted with blue accent
- ✅ Latest hand in latest match has blue border
- ✅ Haptic feedback on expand/collapse (if supported)
- ✅ Card images render correctly (text-based, 35×51)
- ✅ Combo type displayed (Single, Pair, Triple, etc.)
- ✅ Empty state if no history
- ✅ FlatList handles 100+ hands smoothly (virtualization)

**Android-Specific:**
- Verify FlatList virtualization works correctly
- Check removeClippedSubviews optimization
- Test on API 28 device for compatibility

---

### Test 8: Action Buttons

**Steps:**
1. Tap "Share Results" button
2. Tap "Play Again" button
3. Tap "Return to Menu" button

**Expected Results:**

**Share Results:**
- ✅ Haptic feedback on tap (if supported)
- ✅ Android Share sheet appears
- ✅ Share text includes winner and standings
- ✅ Medal emojis included in share text (check encoding)
- ✅ Fallback Alert if share fails

**Play Again:**
- ✅ Haptic feedback on tap
- ✅ Confirmation dialog: "Start a new game with the same players?"
- ✅ Cancel button dismisses dialog
- ✅ New Game button calls onPlayAgain callback
- ✅ Modal closes before game restarts
- ✅ Game reinitializes with same players

**Return to Menu:**
- ✅ Haptic feedback on tap
- ✅ Confirmation dialog: "Leave the current game and return to the main menu?"
- ✅ Stay button dismisses dialog
- ✅ Leave Game button calls onReturnToMenu callback
- ✅ Modal closes before navigation
- ✅ Navigation resets to Home screen

**Android-Specific:**
- Verify Android Alert styling
- Check button text visibility on different themes

---

### Test 9: Fireworks Performance

**Steps:**
1. Open game end modal
2. Observe fireworks for full 5 seconds
3. Check FPS using Android Studio Profiler (if available)

**Expected Results:**
- ✅ Fireworks play for 5 seconds
- ✅ 8 bursts distributed across screen (Android medium tier)
- ✅ 8 particles per burst, radiating outward (optimized)
- ✅ Smooth 60fps animation (or close on older devices)
- ✅ Colors are vibrant and varied (HSL to RGB conversion)
- ✅ Fireworks positioned behind modal (zIndex: 9998)
- ✅ No touch blocking (pointerEvents: none)

**Device-Specific:**
- Pixel 5: Should maintain 60fps
- Galaxy S23: Should be very smooth (120Hz display)
- API 28: May drop to 30-45fps (acceptable)

**Performance Tiers:**
- High: 12 bursts × 12 particles = 144 (iOS default)
- Medium: 8 bursts × 8 particles = 64 (Android default)
- Low: 6 bursts × 6 particles = 36 (fallback)

---

### Test 10: Touch Targets

**Steps:**
1. Measure button sizes visually
2. Test tapping all interactive elements
3. Test with Android Accessibility Scanner

**Expected Results:**
- ✅ All buttons ≥48dp touch target (Android guideline)
- ✅ Action buttons: 56pt min height (adjusted for dp)
- ✅ Tab buttons: Full width, adequate height
- ✅ Collapsible match headers: Easy to tap
- ✅ No accidental taps on adjacent elements
- ✅ Ripple effect on button presses

**Android-Specific:**
- Check ripple effect visibility
- Verify touch feedback is responsive

---

### Test 11: Memory & Performance

**Steps:**
1. Open and close modal 10 times
2. Play multiple games with modal
3. Monitor memory using Android Studio Profiler

**Expected Results:**
- ✅ No memory leaks
- ✅ Animations clean up properly
- ✅ Modal opens/closes quickly (<500ms)
- ✅ No performance degradation over time
- ✅ App remains responsive
- ✅ No ANR (Application Not Responding) errors

**Android-Specific:**
- Check GC (Garbage Collection) activity
- Monitor native heap usage
- Verify no memory warnings

---

### Test 12: Edge Cases

**Steps:**
1. Test with 2 players (minimum)
2. Test with all players busted (>100pts)
3. Test with tied scores
4. Test with very long player names
5. Test with empty score/play history

**Expected Results:**
- ✅ 2-player game displays correctly
- ✅ All busted: Winner is still lowest score
- ✅ Tied scores: Both shown in correct order
- ✅ Long names: Truncate or wrap gracefully
- ✅ Empty history: Empty state with helpful message

**Android-Specific:**
- Check text wrapping on different screen densities (mdpi, xhdpi, xxhdpi)
- Verify fonts render correctly

---

### Test 13: Android-Specific Issues

**Steps:**
1. Test with different system languages (RTL)
2. Test with dark mode enabled
3. Test with different font sizes (accessibility)
4. Test with TalkBack enabled (screen reader)

**Expected Results:**
- ✅ RTL languages: Layout mirrors correctly (if applicable)
- ✅ Dark mode: Colors adapt appropriately
- ✅ Large fonts: Text scales without breaking layout
- ✅ TalkBack: All elements have proper labels

---

## Android Testing Report Template

```
Date: _______________
Tester: _______________

Device: Pixel 5 / Galaxy S23 / Other (specify) _______________
Android Version: API ___ (Android ___)

Test Results:
- Modal Display & Animation: PASS / FAIL
- Responsive Sizing: PASS / FAIL
- Safe Area Handling: PASS / FAIL
- Final Standings: PASS / FAIL
- Tab Switching: PASS / FAIL
- Score History Tab: PASS / FAIL
- Play History Tab: PASS / FAIL
- Action Buttons: PASS / FAIL
- Fireworks Performance: PASS / FAIL
- Touch Targets: PASS / FAIL
- Memory & Performance: PASS / FAIL
- Edge Cases: PASS / FAIL
- Android-Specific: PASS / FAIL

Overall: PASS / FAIL

Performance Notes:
- Fireworks FPS: _______ fps
- Modal open time: _______ ms
- Memory usage: _______ MB

Issues Found:
_______________________________
_______________________________
_______________________________

Notes:
_______________________________
_______________________________
_______________________________
```

---

## Critical Success Criteria (Android)

- [ ] Modal springs in smoothly on all devices
- [ ] Fireworks maintain ≥30fps on API 28 devices
- [ ] Fireworks maintain 60fps on Pixel 5 / Galaxy S23
- [ ] Safe areas respected on gesture navigation devices
- [ ] Responsive sizing works in all orientations
- [ ] All touch targets ≥48dp
- [ ] Haptic feedback works (or fails gracefully)
- [ ] No memory leaks after 10 modal cycles
- [ ] Share functionality works correctly
- [ ] Navigation callbacks fire correctly
- [ ] Empty states display helpful messages
- [ ] Emoji rendering works on all tested devices

---

## Known Android Limitations

1. **Haptic Feedback:** Not all Android devices support haptic feedback. The app should gracefully handle missing haptic support without crashing.

2. **Emoji Rendering:** Older Android versions (API 28) may not render all emojis correctly. Consider emoji compat library if issues arise.

3. **Performance:** Fireworks optimized to medium tier (8×8) on Android. Lower-end devices may still experience frame drops below 60fps, but should maintain ≥30fps minimum.

4. **Font Rendering:** Text rendering may vary across Android manufacturers (Samsung, Google, OnePlus). Test on multiple OEM devices if possible.
