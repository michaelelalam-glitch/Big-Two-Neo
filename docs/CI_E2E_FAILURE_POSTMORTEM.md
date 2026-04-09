# CI E2E Failure Postmortem — PR #227

**Branch:** `fix/sprint-5-infrastructure-polish-tech-debt`  
**PR:** [#227](https://github.com/michaelelalam-glitch/Big-Two-Neo/pull/227)  
**Last green run:** `24126072920` at commit `7f5dbfd4` (2026-04-08)  
**Total failed runs:** 35+  
**Resolution:** Reverted E2E workflow + `android-e2e.sh` to `7f5dbfd4` state (smoke-only)

---

## Summary

CI was green until commit `1f41e651` (add game room flows 66-85) introduced problems. Subsequent attempts to add **authenticated E2E flows** (`ci-authenticated` tag) spanning 35+ CI runs across two weeks all failed. The authenticated phase required injecting a live Supabase session into the app's AsyncStorage before Maestro flows ran — a fundamentally flaky approach that was never stabilised on CI.

---

## Phase 1 — Smoke Flow Fixes (runs before auth injection)

These runs failed on the **smoke flows** themselves, not auth injection. All issues were fully fixed.

| Commit | Run | Failure | Fix |
|--------|-----|---------|-----|
| `1f41e651` | 24134607670 | Flows 66-85 (game-room) in `e2e/flows/` — Maestro parses **all** YAML files in directory regardless of tag filters, causing "missing sub-flow" parse errors for the incomplete game-room flows | Moved 66-85 to `e2e/flows-wip/` — Maestro only parses the target directory passed to the CLI |
| `618300d8` | 24132012758 | Flow 27 had an emoji (`🔔`) in an `assertVisible` command → `Unknown Property: id` parse error | Removed emoji from assertVisible |
| `b0069b58` | — | `setOrientation: landscape` rejected by Maestro 2.x — must be `LANDSCAPE_LEFT` or `LANDSCAPE_RIGHT` | Used `LANDSCAPE_LEFT` |
| `0b70c1cd` | 24161711110 | Invalid Maestro command syntax in flows 33-85 (e.g., bare `tapOn:` without value, wrong indent) | Fixed all 36 flow files with correct YAML structure |
| `fcacb67c` | 24159929335 | `extendedWaitUntil` in 38 flows used bare `id: foo` selector which requires wrapping in `visible: true` under the new Maestro 2.x API | Wrapped all `id:` selectors in `visible: true` |
| `ec68ca3c` | 24164343047 | Flow 55 was referenced as `ci-online` tag but file was missing; Maestro validates all files in directory even for non-tagged runs → parse error | Added stub `55_ci_online_join_existing.yaml` |
| `faf934a5` | 24165334640 | Same landscape setOrientation fix not propagated to flow 20 | Fixed flow 20 |
| `399173d2` | 24166335362 | WIP flows (66-85) still being parsed despite tag filter — `flows/` and `flows-wip/` now separate | Moved all 66-85 to `flows-wip/` definitively |
| `28338ac5` | 24148434152 | Maestro CLI auto-updated to v2.x which introduced breaking changes to `tapOn` id property syntax | Pinned Maestro CLI to v1.41.0 in workflow |

**Lesson:** Maestro parses **every YAML file** in the directory passed to `maestro test`, regardless of `--include-tags`. Always keep incomplete/WIP flows in a separate directory.

---

## Phase 2 — Auth Injection Attempts (all failed)

Once smoke flows reliably passed (12/12 on Android), the work shifted to adding authenticated E2E flows. The app uses `@react-native-async-storage/async-storage v2.2.0` which changed the storage backend from SQLite (RKStorage) to Room (a WAL-mode SQLite database tagged `AsyncStorage`). All auth injection approaches failed to reliably deliver a session that the running app could read.

### Attempt 1 — Direct RKStorage injection (commits `28fc69b8`, `22e556c7`)

**Approach:** `adb root` → open `RKStorage` SQLite via `sqlite3` → `INSERT OR REPLACE INTO catalystLocalStorage`.  
**Expected:** App reads from RKStorage on startup.  
**Actual failure:** App uses async-storage v2 which reads from Room (`AsyncStorage` DB), not RKStorage. Session never visible to app. 36/36 flows fail with `"Choose a game to play" is visible` (consent or auth screen blocking home screen).  
**Run:** 24136656661, 24167869016  
**Lesson:** async-storage v2 migrates RKStorage to Room on first launch, but does NOT read from RKStorage on subsequent launches.

---

### Attempt 2 — Room DB direct INSERT (commit `d42b36e1`, `19f4ea5f`)

**Approach:** `INSERT INTO Storage (key, value) VALUES (...)` directly into the Room `AsyncStorage` DB via `adb shell sqlite3`.  
**Expected:** Room DB has session row → app reads it.  
**Actual failure:** Room DB uses WAL mode; `sqlite3` inserts fail with `no such table: Storage` because Room hadn't created the schema yet (cold emulator, first launch). Even when the DB file existed, WAL checkpoint races caused `sqlite3` to see an inconsistent view.  
**Runs:** 24139306502  
**Lesson:** Room databases can only be safely modified through the Room API, not raw SQLite — the schema may not be initialised, and WAL checkpoints create race conditions.

---

### Attempt 3 — WAL checkpoint before injection (commit `c3460db1`)

**Approach:** Force WAL checkpoint (`PRAGMA wal_checkpoint(FULL)`) before injection so rows are visible in the main DB file.  
**Expected:** WAL flushed → `sqlite3` sees the schema.  
**Actual failure:** The DB file still didn't exist at injection time (app hadn't launched yet). `sqlite3` created an empty file with no schema. Auth rows never landed.  
**Run:** 24170417593  
**Lesson:** You cannot WAL-checkpoint a DB that hasn't been created by Room yet.

---

### Attempt 4 — Pre-warm Room DB (commits `b079b09a`, `2083125b`, `6c6abe3c`)

**Approach:** Launch app first (triggering Room to initialise the DB) → force-stop → inject via `sqlite3` → restart.  
**Expected:** Room creates schema during warm-up → `sqlite3` can then INSERT auth row.  
**Actual failures:**
- `b079b09a`: Pre-warm timing was too short (10s). Room not ready on cold CI emulator.  
- `2083125b`: Extended to 30s pre-poll + 90s polling loop. Added `mkdir` for DB dir as root. But `mkdir` as root left DB dir owned by root → Room DB creation blocked (`EACCES`).  
- `6c6abe3c`: Removed root-owned mkdir. Still timing out — Room init takes >90s on CI cold boot.  
**Runs:** 24172164763, 24173421594, 24174683600  
**Lesson:** Room DB initialisation is non-deterministic on cold CI emulators. Polling-based waits are fragile; any window shorter than the actual init time causes a race.

---

### Attempt 5 — RKStorage migration path (commit `eccbcfc9`)

**Approach:** Delete `AsyncStorage` DB file → inject auth into `RKStorage` via `sqlite3` → delete the empty `AsyncStorage` side-effect file → rely on Room's `createFromFile(RKStorage)` migration trigger on first launch.  
**Expected:** On first launch, Room sees `RKStorage` exists and `AsyncStorage` does NOT → runs `MIGRATION_TO_NEXT` (copies `catalystLocalStorage` rows into Room `Storage` table).  
**Actual failure:** `VERIFY_LEGACY=1` (injection confirmed), but 36/36 auth flows all fail with `"Choose a game to play" is visible`. The **consent modal** was blocking the app. `@big2_analytics_consent` was `null` (not set) → splash → consent modal → app never reaches home screen. The consent skip was not injected.  
**Run:** 24191169947  
**Lesson:** Two independent AsyncStorage keys must be injected: the auth token AND the consent bypass. Missing either one causes app to block before reaching the authenticated home screen.

---

### Attempt 6 — RKStorage migration + consent injection + iOS container fix (commit `d855f736`)

**Approach (Android):** Same RKStorage migration as attempt 5 + inject `@big2_analytics_consent=false` alongside auth token.  
**Approach (iOS):** Use `xcrun simctl get_app_container booted {bundleId} data` to get the exact active container path (instead of `find` glob which returns stale old container UUIDs). Also: uninstall+reinstall between smoke attempts to guarantee a fresh container UUID.  
**Status:** Run `24192926594` was still `in_progress` when this revert was made. Results unknown.  
**Likely outcome:** Android likely passes (consent fix was the missing piece). iOS container path fix was correct in theory, but the uninstall+reinstall re-warm introduced new risk (flow 14 rapid cold-starts crash).

---

## iOS-Specific Failures (run 24187852818)

### Smoke flows — attempt 2: all 12 fail

**Root cause:** Re-warm between attempt 1 and attempt 2 was `launch + sleep 15 + terminate`. This launched the app **without clearing state**, so `clearState: true` in attempt 2 Maestro flows silently reused the OLD container UUID (the container the app launched into on re-warm). Consent state from flow 15 (`15_privacy_consent_accept_persistence`) was preserved → flows 17/19/20/21 expected consent modal but got home screen → fail.

### Auth flows: all 36 fail

**Root cause:** `findIOSStorageV2()` used a `find` glob returning the **oldest** matching container path. Each `clearState: true` call creates a new container UUID. The injection wrote to an orphaned container UUID, not the one the app was actually loading. Auth session + consent never reached the running app.

---

## Build Infrastructure Fixes (retained in this revert)

These changes from commit `919a32f7` are **not reverted** — they fixed real build problems:

| Fix | Description |
|-----|-------------|
| **Android D8 OOM** | `expo prebuild` writes `org.gradle.jvmargs=-Xmx2048m` which overrides `GRADLE_OPTS`. Patched to `4096m` before Gradle runs. |
| **iOS stale ModuleCache** | Cache key bumped v3→v4 + explicit `rm -rf ModuleCache.noindex` before every Xcode build. Prevents `.pcm` file poisoning when GitHub Actions updates the Xcode toolchain. |

---

## Root Cause Summary

1. **Wrong storage layer targeted:** async-storage v2 uses Room (Android) / file-based storage (iOS). All injection approaches initially targeted the wrong backend.
2. **Race conditions:** Room DB initialisation is non-deterministic on cold CI VMs. Any pre-warm window shorter than actual init time causes a race.
3. **Incomplete injection:** Auth token alone is insufficient — `@big2_analytics_consent` must also be injected or the consent modal blocks the app before login.
4. **iOS container staleness:** `clearState: true` in Maestro creates new container UUIDs. Any injection done before Maestro starts targets the old container.
5. **Re-warm side effects:** Launching the app between Maestro phases pollutes state that `clearState: true` is supposed to wipe.

---

## Prevention Checklist for Future Auth E2E

- [ ] **Verify storage backend version** before writing injection code. Check `@react-native-async-storage/async-storage` package.json `version` field and `StorageSupplier.kt` for Android backend.
- [ ] **Inject ALL blocking keys** — not just the auth token. Audit the app's startup flow and inject every key that gates navigation before the authenticated home screen (consent, onboarding flags, etc.).
- [ ] **Android:** Use the RKStorage migration path only if `async-storage` version < 2.0. For v2+, the correct approach is to write directly into the Room DB. This requires the app to have already run once (DB schema exists). Use a deterministic poll loop with a generous timeout (>60s on CI).
- [ ] **iOS:** Always obtain the container path via `xcrun simctl get_app_container booted {bundleId} data`. Never use `find` globs — multiple containers accumulate from prior `clearState: true` calls.
- [ ] **Injection timing:** Inject AFTER smoke flows complete and AFTER `xcrun simctl terminate` confirms the app is stopped. Then re-inject before the auth retry attempt too.
- [ ] **Use a dedicated E2E auth profile** in Supabase that does not expire during the test run (check `expires_at` in the stored session JSON).
- [ ] **Separate smoke CI from auth CI** at the job level — smoke can fail-fast independently of auth. This surfaces smoke regressions without auth injection noise.
- [ ] **Local validation first:** Before pushing auth injection scripts, test the full injection → app launch → session read cycle on a local emulator/simulator with identical settings to CI.
