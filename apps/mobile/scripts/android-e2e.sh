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
# backend). Sessions ultimately need to land in the Room AsyncStorage DB's
# `Storage` table.
#
# STRATEGY — RKStorage migration path:
#   1. Delete the existing Room DB files (AsyncStorage*) so that Room is
#      forced through its `createFromFile(RKStorage)` migration path on the
#      very next cold launch.
#   2. Inject the session into RKStorage's `catalystLocalStorage` table.
#   3. On the first authenticated-flow `launchApp`, Room:
#        a. Sees RKStorage exists and AsyncStorage does NOT → copies RKStorage
#           as the initial DB and runs MIGRATION_TO_NEXT (v1→v2).
#        b. Migration creates `Storage` table and copies every row from
#           `catalystLocalStorage` — our auth token is now in Room Storage.
#   This avoids timing/WAL-lock races with trying to read the DB while the
#   app holds it open.

DB_DIR=/data/data/com.big2mobile.app/databases
APP_OWNER=$(adb shell stat -c '%u:%g' /data/data/com.big2mobile.app/ 2>/dev/null || echo "u0_a126:u0_a126")

# Stop the app so it releases any SQLite file locks before we touch the DB.
adb shell am force-stop com.big2mobile.app || true
sleep 2

# Delete existing Room DB so Room is forced to create it fresh from RKStorage.
echo "Removing Room DB files to force RKStorage migration path..."
adb shell "rm -f \
  ${DB_DIR}/AsyncStorage \
  ${DB_DIR}/AsyncStorage-wal \
  ${DB_DIR}/AsyncStorage-shm" 2>/dev/null || true

echo "Injecting E2E auth session for ${E2E_TEST_EMAIL}..."
CI_PLATFORM=android \
  EXPO_PUBLIC_SUPABASE_URL="${EXPO_PUBLIC_SUPABASE_URL}" \
  EXPO_PUBLIC_SUPABASE_ANON_KEY="${EXPO_PUBLIC_SUPABASE_ANON_KEY}" \
  E2E_TEST_EMAIL="${E2E_TEST_EMAIL}" \
  E2E_TEST_PASSWORD="${E2E_TEST_PASSWORD}" \
  node apps/mobile/scripts/ci-seed-e2e-auth.mjs

# The injection script's Room attempt opens 'sqlite3 AsyncStorage' even when
# the INSERT fails — sqlite3 creates an empty AsyncStorage file as a side
# effect.  If that file exists, Room will NOT use the createFromFile(RKStorage)
# migration path and the session will never reach the Storage table.
# Delete it again now so Room is guaranteed to go through the migration.
echo "Re-removing any empty AsyncStorage file created by sqlite3 side-effect..."
adb shell "rm -f \
  ${DB_DIR}/AsyncStorage \
  ${DB_DIR}/AsyncStorage-wal \
  ${DB_DIR}/AsyncStorage-shm" 2>/dev/null || true

# Fix database file ownership after root injection.
# sqlite3 running as root may create files owned by root,
# preventing the app (running as its own UID) from reading the database.
echo "Fixing database ownership to ${APP_OWNER}..."
adb shell chown -R "${APP_OWNER}" /data/data/com.big2mobile.app/databases/ || true

# Verify the session is staged in RKStorage — Room will auto-migrate from it
# on the first authenticated cold launch (createFromFile + MIGRATION_TO_NEXT).
# We do NOT require Room=1 here because AsyncStorage was intentionally deleted;
# checking it now would just re-create/lock the DB outside the app.
echo "Verifying auth injection..."
VERIFY_LEGACY=$(adb shell "sqlite3 /data/data/com.big2mobile.app/databases/RKStorage 'SELECT count(*) FROM catalystLocalStorage WHERE key LIKE \"sb-%-auth-token\";'" 2>/dev/null | tr -d '[:space:]' || echo 0)
echo "Database files:"
adb shell "ls -la /data/data/com.big2mobile.app/databases/" || true
echo "Auth rows — RKStorage/catalystLocalStorage (migration source): ${VERIFY_LEGACY}"
if [ "${VERIFY_LEGACY}" != "1" ]; then
  echo "::error::Auth injection FAILED — session not staged in RKStorage. VERIFY_LEGACY=${VERIFY_LEGACY}. Check ci-seed-e2e-auth.mjs output above."
  adb unroot || true
  exit 1
fi
echo "✅ Auth injection verified (RKStorage: ${VERIFY_LEGACY}). Room DB will be created via migration on first launch."

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
