# Game End RN Manual Testing Guide

## iOS Manual Testing Checklist (Task #400)

**Devices to Test:**
- iPhone SE (2nd gen) - Smallest screen
- iPhone 14 Pro - Notch/Dynamic Island
- iPad Pro 11" - Tablet experience

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
- ✅ Trophy emoji 🏆 appears on both sides of winner name
- ✅ Modal is centered on screen
- ✅ Backdrop is semi-transparent (85% opacity)

**Device-Specific:**
- iPhone 14 Pro: Verify notch clearance at top
- iPad: Modal should be max 600px wide, centered

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
- ✅ All touch targets remain ≥44pt

**Device-Specific:**
- iPhone SE: Verify landscape mode doesn't cut off content
- iPad: Verify split-screen mode (if applicable)

---

### Test 3: Safe Area Handling

**Steps:**
1. Open modal on iPhone with notch (14 Pro)
2. Check all edges of modal
3. Test in both portrait and landscape

**Expected Results:**
- ✅ Content doesn't overlap notch/Dynamic Island
- ✅ Content doesn't overlap home indicator
- ✅ Landscape: Content respects side bezels
- ✅ SafeAreaView edges: ['top', 'bottom', 'left', 'right']

---

### Test 4: Final Standings

**Steps:**
1. View Final Standings section
2. Verify player order and colors
3. Check medal emojis

**Expected Results:**
- ✅ Players sorted by score (lowest to highest)
- ✅ 1st place: 🥇 Gold medal
- ✅ 2nd place: 🥈 Silver medal
- ✅ 3rd place: 🥉 Bronze medal
- ✅ Winner: Green text (#4ade80)
- ✅ Busted (>100pts): Red text (#f87171)
- ✅ Others: White text (#f3f4f6)

---

### Test 5: Tab Switching

**Steps:**
1. Tap "Score History" tab (default)
2. Tap "Play History" tab
3. Tap back to "Score History"
4. Rapidly switch between tabs

**Expected Results:**
- ✅ Haptic feedback on each tap (medium impact)
- ✅ Tab content fades out (150ms) → switches → fades in (150ms)
- ✅ Tab indicator slides smoothly (300ms)
- ✅ Active tab has blue highlight (rgba(59, 130, 246, 0.3))
- ✅ No flicker or visual glitches
- ✅ Rapid tapping doesn't break animation

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
- ✅ Scrolling is smooth

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
- ✅ Haptic feedback on expand/collapse
- ✅ Card images render correctly (text-based, 35×51)
- ✅ Combo type displayed (Single, Pair, Triple, etc.)
- ✅ Empty state if no history
- ✅ FlatList handles 100+ hands smoothly

---

### Test 8: Action Buttons

**Steps:**
1. Tap "Share Results" button
2. Tap "Play Again" button
3. Tap "Return to Menu" button

**Expected Results:**

**Share Results:**
- ✅ Haptic feedback on tap
- ✅ iOS Share sheet appears
- ✅ Share text includes winner and standings
- ✅ Medal emojis included in share text
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

---

### Test 9: Fireworks Performance

**Steps:**
1. Open game end modal
2. Observe fireworks for full 5 seconds
3. Check FPS in Xcode Instruments (if available)

**Expected Results:**
- ✅ Fireworks play for 5 seconds
- ✅ 12 bursts distributed across screen (iOS high tier)
- ✅ 12 particles per burst, radiating outward
- ✅ Smooth 60fps animation
- ✅ Colors are vibrant and varied (HSL-based)
- ✅ Fireworks positioned behind modal (zIndex: 9998)
- ✅ No touch blocking (pointerEvents: none)

**Device-Specific:**
- iPhone SE: Should maintain 60fps (iOS optimized)
- iPhone 14 Pro: ProMotion 120Hz should be smooth

---

### Test 10: Touch Targets

**Steps:**
1. Measure button sizes visually
2. Test tapping all interactive elements
3. Test with accessibility inspector

**Expected Results:**
- ✅ All buttons ≥44pt touch target (iOS guideline)
- ✅ Action buttons: 56pt min height
- ✅ Tab buttons: Full width, adequate height
- ✅ Collapsible match headers: Easy to tap
- ✅ No accidental taps on adjacent elements

---

### Test 11: Memory & Performance

**Steps:**
1. Open and close modal 10 times
2. Play multiple games with modal
3. Monitor memory in Xcode

**Expected Results:**
- ✅ No memory leaks
- ✅ Animations clean up properly
- ✅ Modal opens/closes quickly (<500ms)
- ✅ No performance degradation over time
- ✅ App remains responsive

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

---

## iOS Testing Report Template

```
Date: _______________
Tester: _______________

Device: iPhone SE / 14 Pro / iPad Pro (circle one)
iOS Version: _______________

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

Overall: PASS / FAIL

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

## Critical Success Criteria (iOS)

- [ ] Modal springs in smoothly on all devices
- [ ] Fireworks maintain 60fps on iPhone SE
- [ ] Safe areas respected on iPhone 14 Pro
- [ ] Responsive sizing works in all orientations
- [ ] All touch targets ≥44pt
- [ ] Haptic feedback on all interactive elements
- [ ] No memory leaks after 10 modal cycles
- [ ] Share functionality works correctly
- [ ] Navigation callbacks fire correctly
- [ ] Empty states display helpful messages
