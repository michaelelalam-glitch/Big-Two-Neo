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

# Launch app once to warm up (also causes AsyncStorage DB to be created)
adb shell am start -n com.big2mobile.app/.MainActivity || true
sleep 10
adb shell am force-stop com.big2mobile.app || true
sleep 3

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
# /data/data/<package>/databases/RKStorage (requires root on userdebug images).
# We do this AFTER the smoke test phase to avoid disrupting Maestro's adb
# connection via the daemon restart that adb root causes.
echo "Elevating adb to root for auth injection..."
adb root || echo "::warning::adb root unavailable — sqlite3 injection may fail"
sleep 3
adb wait-for-device

echo "Injecting E2E auth session for ${E2E_TEST_EMAIL}..."
CI_PLATFORM=android \
  EXPO_PUBLIC_SUPABASE_URL="${EXPO_PUBLIC_SUPABASE_URL}" \
  EXPO_PUBLIC_SUPABASE_ANON_KEY="${EXPO_PUBLIC_SUPABASE_ANON_KEY}" \
  E2E_TEST_EMAIL="${E2E_TEST_EMAIL}" \
  E2E_TEST_PASSWORD="${E2E_TEST_PASSWORD}" \
  node apps/mobile/scripts/ci-seed-e2e-auth.mjs

# Drop back to shell user so Maestro's adb connection isn't running as root.
adb unroot || true
sleep 2
adb wait-for-device

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
