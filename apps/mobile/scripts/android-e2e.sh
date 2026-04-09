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

# NOTE: The app uses @react-native-async-storage/async-storage v2.x (Room
# backend). Sessions must land in the Room AsyncStorage DB's `Storage` table.
# Room only creates the Storage table after the app has opened the database
# at least once — so we pre-warm the app here to ensure Room initialises
# before we inject.

DB_DIR=/data/data/com.big2mobile.app/databases
APP_OWNER=$(adb shell stat -c '%u:%g' /data/data/com.big2mobile.app/ 2>/dev/null || echo "u0_a126:u0_a126")

# Pre-warm: launch app so Room creates the AsyncStorage DB + Storage table.
echo "Pre-warming app to initialize Room DB (async-storage v2)..."
adb shell monkey -p com.big2mobile.app 1 2>/dev/null || true

# Poll until the Storage table exists (Room initialises synchronously on
# first open, so this is typically ready in < 3s).
ROOM_READY=0
for i in $(seq 1 20); do
  TABLES=$(adb shell "sqlite3 ${DB_DIR}/AsyncStorage '.tables'" 2>/dev/null | tr -d '[:space:]' || echo "")
  if echo "$TABLES" | grep -q "Storage"; then
    echo "Room AsyncStorage DB ready after ${i}s"
    ROOM_READY=1
    break
  fi
  sleep 1
done
if [ "$ROOM_READY" = "0" ]; then
  echo "::warning::Room DB not ready after 20s — injection will likely fall back to RKStorage and fail auth flows"
fi

# Stop the app before injection so it releases any SQLite file locks.
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
# sqlite3 running as root may create files owned by root,
# preventing the app (running as its own UID) from reading the database.
echo "Fixing database ownership to ${APP_OWNER}..."
adb shell chown -R "${APP_OWNER}" /data/data/com.big2mobile.app/databases/ || true

# Verify the injected session is readable — check BOTH backends.
# The app uses async-storage v2 (Room), so VERIFY_ROOM must be 1.
echo "Verifying auth injection..."
VERIFY_ROOM=$(adb shell "sqlite3 /data/data/com.big2mobile.app/databases/AsyncStorage 'SELECT count(*) FROM Storage WHERE key LIKE \"sb-%-auth-token\";'" 2>/dev/null | tr -d '[:space:]' || echo 0)
VERIFY_LEGACY=$(adb shell "sqlite3 /data/data/com.big2mobile.app/databases/RKStorage 'SELECT count(*) FROM catalystLocalStorage WHERE key LIKE \"sb-%-auth-token\";'" 2>/dev/null | tr -d '[:space:]' || echo 0)
echo "Auth rows — Room (AsyncStorage/Storage): ${VERIFY_ROOM} | Legacy (RKStorage/catalystLocalStorage): ${VERIFY_LEGACY}"
echo "Database files:"
adb shell "ls -la /data/data/com.big2mobile.app/databases/" || true
if [ "${VERIFY_ROOM}" != "1" ]; then
  echo "::error::Auth injection FAILED — session not found in Room AsyncStorage DB (app uses async-storage v2). Room: ${VERIFY_ROOM}, RKStorage: ${VERIFY_LEGACY}. Check ci-seed-e2e-auth.mjs output above."
  adb unroot || true
  exit 1
fi
echo "✅ Auth injection verified (Room: ${VERIFY_ROOM}, RKStorage: ${VERIFY_LEGACY})."

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
