# CI/CD Pipeline Audit Report — February 26, 2026

**Branch:** `game/chinese-poker` (PR #82)  
**Auditor:** GitHub Copilot  
**Scope:** All changes made to pass CI (ESLint, TypeScript, Tests) — identifying shortcuts that mask issues rather than fixing them.

---

## Executive Summary

The CI pipeline now passes all gates: **0 ESLint errors, 0 TypeScript errors, 861/861 tests passing**. However, several shortcuts were taken to achieve this. This report classifies each by severity and provides actionable remediation.

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 3 | Real production risks hidden by shortcuts |
| 🟡 Medium | 5 | Technical debt that should be addressed before production |
| 🟢 Low | 4 | Acceptable trade-offs with minor cleanup needed |

---

## 🔴 Critical Shortcuts (Must Fix Before Production)

### C1. CI Test Steps Cannot Fail the Build

**File:** `.github/workflows/test.yml` (lines 63–74)

**What was done:** Both unit and integration test steps use `|| true` which **swallows all exit codes**. Even if every test fails, CI will report ✅.

```yaml
timeout 180 pnpm run test:unit --passWithNoTests --forceExit || true
```

**Risk:** A future regression that breaks all 861 tests will pass CI silently. The `|| true` was added to work around the `--forceExit` non-zero exit code (Jest exits with code 1 when it force-exits), but it also suppresses genuine test failures.

**Recommendation:**
```yaml
- name: 🧪 Run unit tests
  run: |
    cd apps/mobile
    pnpm run test:unit --passWithNoTests --forceExit
  timeout-minutes: 4
```
Remove `|| true` and `timeout 180`. Instead, fix the root cause: the open handles that require `--forceExit`. The `timeout-minutes: 4` at the GitHub Actions level is sufficient as a safety net. If `--forceExit` still causes a non-zero exit code after all tests pass, pipe through a wrapper script that distinguishes "tests passed but force-exited" from "tests failed."

---

### C2. ESLint Step Cannot Fail the Build

**File:** `.github/workflows/test.yml` (lines 53–56)

**What was done:** The ESLint step has `continue-on-error: true` and uses `|| echo` to swallow failures:

```yaml
- name: 🔍 Run ESLint
  run: |
    cd apps/mobile
    pnpm run lint || echo "::warning::ESLint found issues"
  continue-on-error: true
```

**Risk:** Any new ESLint errors introduced by future PRs will not block merge. The linting gate is entirely cosmetic.

**Recommendation:** Remove `continue-on-error: true` and the `|| echo` fallback. ESLint should be a hard gate:
```yaml
- name: 🔍 Run ESLint
  run: |
    cd apps/mobile
    pnpm run lint
```

---

### C3. Five Whole Functions Prefixed with `_` Instead of Removed in `useRealtime.ts`

**File:** `src/hooks/useRealtime.ts` — 1,926 lines

**What was done:** Five complete functions (~200 lines total) were prefixed with `_` to silence `no-unused-vars`:

| Line | Function | Lines of Code |
|------|----------|---------------|
| 207 | `_getServerTimeMs()` | ~18 lines |
| 255 | `_calculatePlayerMatchScore()` | ~30 lines |
| 286 | `_shouldGameEnd()` | ~3 lines |
| 293 | `_findFinalWinner()` | ~12 lines |
| 327 | `_determine5CardCombo()` | ~80 lines |

**Risk:** These are **complete game logic implementations** — scoring, game end detection, combo classification — sitting as dead code. If the multiplayer game actually needs them but calls server-side equivalents, having stale client-side copies is a maintenance trap. If they're truly dead, they inflate the file by 10% and confuse future developers.

**Recommendation:**
- **If these functions are used by Edge Functions (server-side):** Delete them entirely from the client. They don't belong in a 1,926-line hook.
- **If they are planned for client-side use:** Remove the `_` prefix and wire them up, or move to a shared `game/scoring.ts` module.
- Either way, `useRealtime.ts` at **1,926 lines** is far too large for a single hook and should be decomposed regardless.

---

## 🟡 Medium Shortcuts (Address Before Production)

### M1. `react-hooks/exhaustive-deps` Turned Off Globally

**File:** `.eslintrc.js` (line 33)

**What was done:** The rule was set to `'off'` with the comment "Many deps are intentionally excluded to prevent infinite loops."

**What it hides:** 34 instances across the codebase where React hooks have missing or incorrect dependency arrays. While *some* are intentional, turning the rule off globally means:
- New developers can write hooks with missing deps and get no feedback
- Actual bugs (stale closures causing incorrect renders) go undetected

**Affected files include:**
- `AuthContext.tsx` — missing `fetchProfile` and `profile` deps
- `useBotCoordinator.ts` — missing `gameState` dep
- `useRealtime.ts` — several missing deps including `joinChannel`, `onMatchEnded`, `room`
- `GameScreen.tsx` — unnecessary deps in `useMemo` calls

**Recommendation:** Set to `'warn'` instead of `'off'`. Then systematically triage each warning:
- For intentional exclusions: add `// eslint-disable-next-line react-hooks/exhaustive-deps` with a comment explaining *why*
- For genuine missing deps: add them and protect with `useRef` if needed to prevent infinite loops
- For unnecessary deps: remove them

---

### M2. `@typescript-eslint/no-explicit-any` Turned Off Globally

**File:** `.eslintrc.js` (line 29)

**What was done:** Disabled entirely. The comment says "Too pervasive; strict typing is a separate initiative."

**What it hides:** 239+ instances of `any` across the codebase. While React Native codebases often have more `any` than pure TypeScript projects (due to native modules, navigation params, etc.), disabling the rule entirely removes the guardrail.

**Recommendation:** Set to `'warn'` and gradually address. Priority areas:
- Function parameters in hooks (`useRealtime`, `useBotCoordinator`) — these handle game state and should be strongly typed
- Supabase query responses — use generated types from `supabase gen types`
- Component props — should always be typed via interfaces

---

### M3. Dead Code / Unused State Variables Silenced with `_` Prefix (15+ instances)

**Files:** `GameScreen.tsx`, `LocalAIGameScreen.tsx`, `MultiplayerGameScreen.tsx`, `CompactScoreboard.tsx`, and others

**Key patterns found:**

| File | Variable | Pattern |
|------|----------|---------|
| `GameScreen.tsx` | `_ACTION_DEBOUNCE_MS = 300` | Unused constant — debouncing was planned but never implemented |
| `GameScreen.tsx` | `_multiplayerRoomId`, `_multiplayerPlayerHands`, `_isMultiplayerConnected` | State variables set but never read — likely replaced by different data flow |
| `GameScreen.tsx` | `_mapPlayersToScoreboardOrder`, `_mapGameIndexToScoreboardPosition` | Hook return values destructured but unused |
| `GameScreen.tsx` | `_newState` | Assigned from `initializeGame()` but never used |
| 3 screen files | `_isPlayingCards`, `_isPassing` | useState setters used but state values never read |
| `CreateRoomScreen.tsx` | `_generateRoomCode` | Entire function defined but never called |
| `CompactScoreboard.tsx` | `_cardCount` | Computed but never rendered |

**Risk:** This is ~300 lines of dead code across production screens. The `_` prefix passes ESLint but the code is still compiled, bundled, and shipped to users. The `useState` calls (`_isPlayingCards`, `_isPassing`) cause unnecessary re-renders in 3 different game screens.

**Recommendation:**
- Delete truly dead code (`_ACTION_DEBOUNCE_MS`, `_generateRoomCode`, `_newState`, `_cardCount`)
- For unused `useState` values: if only the setter is used, the getter causes pointless re-renders. Consider using `useRef` instead, or remove entirely if the setter is also dead
- For unused hook return values: don't destructure them — just omit from the destructuring pattern
- `GameScreen.tsx` at **1,610 lines** needs decomposition — many of these are symptoms of an overgrown component

---

### M4. Coverage Not Generated in CI

**File:** `.github/workflows/test.yml` (line 80) + `package.json`

**What was done:** CI has an "Upload test coverage" step that references `./apps/mobile/coverage`, but `test:unit` does **not** include `--coverage`. The `coverage/` directory contains stale data from December 2025.

**Configuration in `jest.config.js`:**
```js
coverageThreshold: {
  global: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80,
  },
},
```

Coverage thresholds of 80% are configured but **never enforced** because the CI test command doesn't generate coverage.

**Recommendation:** Either:
1. Add `--coverage` to the CI test command and let the thresholds enforce quality:
   ```yaml
   pnpm run test:unit --passWithNoTests --forceExit --coverage
   ```
2. Or explicitly remove the coverage step and `coverageThreshold` config if coverage is not a priority yet.

---

### M5. Console Output Completely Suppressed in Tests

**File:** `src/__tests__/setup.ts` (lines 24–31)

**What was done:** All console methods are mocked to `jest.fn()`:
```ts
global.console = {
  ...console,
  log: jest.fn(), debug: jest.fn(), info: jest.fn(),
  warn: jest.fn(), error: jest.fn(),
};
```

**Risk:** If a test triggers a legitimate `console.error` (e.g., React rendering error, unhandled promise rejection), it will be silently swallowed. This can hide real problems during test runs.

**Recommendation:** Restore `console.error` and `console.warn` at minimum, and optionally add a `failOnConsoleError` pattern:
```ts
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  // Keep warn and error visible for debugging
  warn: console.warn,
  error: console.error,
};
```

---

## 🟢 Low Severity (Acceptable with Minor Cleanup)

### L1. `import/order` Rule Turned Off

**File:** `.eslintrc.js` (line 37)

**What was done:** Rule set to `'off'` with a full configuration block that's now dead code.

**Impact:** Import ordering is cosmetic and doesn't affect runtime. The config block should either be removed (if permanently disabled) or the rule re-enabled as a `'warn'`.

**Recommendation:** Remove the dead configuration block since the rule is off, or set to `'warn'` for consistency.

---

### L2. `no-console` Rule Turned Off

**File:** `.eslintrc.js` (line 36)

**What was done:** Disabled with comment "app uses structured logger."

**Impact:** Acceptable if the project deliberately uses `console.log` in production paths. However, 46 instances were hidden. If a structured logger (`gameLogger`, `networkLogger`) exists, leftover `console.log` calls should use it.

**Recommendation:** Set to `['warn', { allow: ['warn', 'error'] }]` and migrate remaining `console.log/info/debug` calls to the structured logger.

---

### L3. Bare `catch {}` Blocks (Error Silencing)

**Files:** `useRealtime.ts` (3), `useOrientationManager.ts` (1), `pushNotificationTriggers.ts` (1), `logger.ts` (1), `StatsScreen.tsx` (1)

**What was done:** Catch parameters were removed entirely (`catch {}`) to silence `no-unused-vars`, losing error context.

**Impact:** Low for most cases (these are retry/fallback patterns), but `useRealtime.ts` has 3 bare catch blocks in critical connection/state paths where logging the actual error would help debug production issues.

**Recommendation:** Restore `catch (error)` and log it:
```ts
} catch (error) {
  networkLogger.warn('[connectToRoom] Retrying fetch players...', error);
  // ... retry logic
}
```

---

### L4. `@typescript-eslint/no-require-imports` Turned Off

**File:** `.eslintrc.js` (line 30)

**What was done:** Disabled for React Native conditional imports.

**Impact:** Low — React Native legitimately uses `require()` for conditional native module loading (expo-screen-orientation, expo-file-system). Only 5 instances existed.

**Recommendation:** Acceptable. Add inline `// eslint-disable-next-line` comments at the 5 specific callsites and re-enable the rule globally.

---

## Summary of Recommended Actions

### Immediate (Before Production Merge)

| Priority | Action | Effort |
|----------|--------|--------|
| 1 | Remove `|| true` from CI test steps | 5 min |
| 2 | Remove `continue-on-error: true` from ESLint step | 5 min |
| 3 | Add `--coverage` to CI test command | 5 min |
| 4 | Delete 5 dead `_`-prefixed functions from `useRealtime.ts` (~200 LOC) | 30 min |
| 5 | Delete obvious dead state variables from `GameScreen.tsx` | 30 min |

### Short-Term (Next Sprint)

| Priority | Action | Effort |
|----------|--------|--------|
| 6 | Set `exhaustive-deps` to `'warn'` and triage 34 instances | 2–4 hr |
| 7 | Restore `catch (error)` + logging in critical paths | 30 min |
| 8 | Set `no-explicit-any` to `'warn'` | 5 min |
| 9 | Restore `console.error`/`console.warn` in test setup | 10 min |
| 10 | Fix open handles causing `--forceExit` to be needed | 2–4 hr |

### Medium-Term (Technical Debt)

| Priority | Action | Effort |
|----------|--------|--------|
| 11 | Decompose `useRealtime.ts` (1,926 lines) | 1–2 days |
| 12 | Decompose `GameScreen.tsx` (1,610 lines) | 1–2 days |
| 13 | Address 239 `any` types in priority modules | 2–3 days |
| 14 | Migrate 46 `console.log` calls to structured logger | 1 day |

---

*Report generated February 26, 2026*
