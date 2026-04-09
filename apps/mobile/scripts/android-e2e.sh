#!/usr/bin/env bash
# android-e2e.sh — Invoked by reactivecircus/android-emulator-runner@v2
# Runs inside the emulator context after the emulator has booted.
# Must be a complete, self-contained bash script because the action runner
# executes each line of script: as a separate sh -c call, which breaks
# multi-line if/then/fi blocks and cross-line variable references.
set -euo pipefail

# Wait for emulator to be fully ready
adb wait-for-device
adb shell 'while [ -z "$(getprop sys.boot_completed)" ]; do sleep 1; done; input keyevent 82'
sleep 5

# Install the APK
APK_PATH=$(find apps/mobile/android/app/build/outputs/apk -name "*.apk" | head -1)
if [ -z "$APK_PATH" ]; then
  echo "::error::No APK found. Build may have failed."
  exit 1
fi
echo "Installing APK: $APK_PATH"
adb install "$APK_PATH"

# ── Phase 1: Pre-auth smoke flows ─────────────────────────────────────────────
# These tests run against an unauthenticated session (sign-in screen).
mkdir -p apps/mobile/e2e/results-android
set +e
maestro test --include-tags ci apps/mobile/e2e/flows/ \
  --format junit \
  --output apps/mobile/e2e/results-android/results-smoke.xml
SMOKE_EXIT=$?
set -e
echo "Maestro Android smoke exit code: $SMOKE_EXIT"

# ── Phase 2: Inject auth session ───────────────────────────────────────────────
# Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD to be set.
# If credentials are absent we skip authenticated flows (non-blocking for forks).
if [ -z "${E2E_TEST_EMAIL:-}" ] || [ -z "${E2E_TEST_PASSWORD:-}" ]; then
  echo "::warning::E2E_TEST_EMAIL/E2E_TEST_PASSWORD not set — skipping authenticated E2E flows."
  exit "$SMOKE_EXIT"
fi

# Switch adb to root mode only for auth injection so we can write to
# /data/data/<package>/databases/ (requires root on userdebug images).
# We do this AFTER the smoke test phase to avoid disrupting Maestro's adb
# connection via the daemon restart that adb root causes.
echo "Elevating adb to root for auth injection..."
adb root || echo "::warning::adb root unavailable — sqlite3 injection may fail"
sleep 3
adb wait-for-device

# Ensure the databases directory exists (clearState may have wiped it)
adb shell "mkdir -p /data/data/com.big2mobile.app/databases" || true

# ── Launch app + wait for Room to initialise AsyncStorage DB ──────────────────
# clearState:true (used by smoke flows) wipes all app data.  Room lazily
# initialises its AsyncStorage database on first JS access.  On a fresh-install
# CI emulator (ART not yet JIT-compiled), the first cold start can take 30–60 s.
# We launch without adb-root so the app runs as its normal UID, wait 30 s for
# the JIT/startup to complete, then re-root and poll for up to 90 s more.
ROOM_READY=0

echo "Launching app to initialise Room AsyncStorage database..."
adb unroot || true
sleep 2
adb wait-for-device
adb shell am start -n com.big2mobile.app/.MainActivity || true

# Give the app time to fully start (ART cold-start on CI can take ~30 s).
# Then re-root so we can query the protected /data/data directory.
echo "Waiting 30 s for cold-start JIT compilation + Room init..."
sleep 30
adb root || true
sleep 3
adb wait-for-device

echo "Polling for Room Storage table (up to 90 s)..."
for POLL_ITER in $(seq 1 45); do
  DB_FILE=$(adb shell "test -f /data/data/com.big2mobile.app/databases/AsyncStorage && echo yes || echo no" 2>/dev/null || echo no)
  if [ "$DB_FILE" = "yes" ]; then
    # Check that Room has also created the Storage table
    TABLE_COUNT=$(adb shell "sqlite3 /data/data/com.big2mobile.app/databases/AsyncStorage 'SELECT count(*) FROM sqlite_master WHERE type=\"table\" AND name=\"Storage\";'" 2>/dev/null | tr -d '[:space:]' || echo 0)
    if [ "$TABLE_COUNT" = "1" ]; then
      echo "Room Storage table ready after ${POLL_ITER} poll(s)."
      ROOM_READY=1
      break
    fi
  fi
  echo "  ...not ready yet (poll $POLL_ITER/45), waiting 2 s"
  sleep 2
done

if [ "$ROOM_READY" != "1" ]; then
  echo "::warning::Room Storage table did not appear in 120 s — attempting injection anyway (may fail)"
fi

# Stop the app cleanly before injection so Room releases its WAL lock
adb shell am force-stop com.big2mobile.app || true
sleep 2

echo "Injecting E2E auth session for ${E2E_TEST_EMAIL}..."
CI_PLATFORM=android \
  EXPO_PUBLIC_SUPABASE_URL="${EXPO_PUBLIC_SUPABASE_URL}" \
  EXPO_PUBLIC_SUPABASE_ANON_KEY="${EXPO_PUBLIC_SUPABASE_ANON_KEY}" \
  E2E_TEST_EMAIL="${E2E_TEST_EMAIL}" \
  E2E_TEST_PASSWORD="${E2E_TEST_PASSWORD}" \
  node apps/mobile/scripts/ci-seed-e2e-auth.mjs

# Fix database file ownership after root injection.
# sqlite3 running as root may create journal/WAL files owned by root,
# preventing the app (running as its own UID) from reading the database.
APP_OWNER=$(adb shell stat -c '%u:%g' /data/data/com.big2mobile.app/)
echo "Fixing database ownership to ${APP_OWNER}..."
adb shell chown -R "${APP_OWNER}" /data/data/com.big2mobile.app/databases/ || true

# Force a WAL checkpoint so the injected data is in the main database file,
# not just in the -wal segment (Room reads both, but this ensures consistency).
echo "Running WAL checkpoint..."
adb shell "sqlite3 /data/data/com.big2mobile.app/databases/AsyncStorage 'PRAGMA wal_checkpoint(TRUNCATE);'" || true

# Verify the injected session is readable — hard-fail if not found
echo "Verifying auth injection..."
INJECT_VERIFY=$(adb shell "sqlite3 /data/data/com.big2mobile.app/databases/AsyncStorage 'SELECT count(*) FROM Storage WHERE key LIKE \"sb-%-auth-token\";'" 2>/dev/null | tr -d '[:space:]' || echo 0)
echo "Auth row count: ${INJECT_VERIFY}"
echo "Database files:"
adb shell "ls -la /data/data/com.big2mobile.app/databases/" || true
if [ "${INJECT_VERIFY}" != "1" ]; then
  echo "::error::Auth injection verify FAILED — Storage table has ${INJECT_VERIFY} auth rows (expected 1). Check ci-seed-e2e-auth.mjs output above."
  adb unroot || true
  exit 1
fi
echo "✅ Auth injection verified (1 row found)."

# Drop back to shell user so Maestro's adb connection isn't running as root.
adb unroot || true
sleep 2
adb wait-for-device

# Force-stop the app so the next launchApp starts completely fresh
# and reads the injected auth session from AsyncStorage.
echo "Restarting app to load injected auth..."
adb shell am force-stop com.big2mobile.app || true
sleep 2

# ── Phase 3: Authenticated E2E flows ──────────────────────────────────────────
set +e
maestro test --include-tags ci-authenticated apps/mobile/e2e/flows/ \
  --format junit \
  --output apps/mobile/e2e/results-android/results-authenticated.xml
AUTH_EXIT=$?
set -e
echo "Maestro Android authenticated exit code: $AUTH_EXIT"

# Fail if either phase failed
if [ "$SMOKE_EXIT" -ne 0 ] || [ "$AUTH_EXIT" -ne 0 ]; then
  echo "::error::One or more Maestro phases failed (smoke=$SMOKE_EXIT, auth=$AUTH_EXIT)"
  exit 1
fi
exit 0
