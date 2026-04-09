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

# Launch app once to warm up
adb shell am start -n com.big2mobile.app/.MainActivity || true
sleep 10
adb shell am force-stop com.big2mobile.app || true
sleep 3

# Run CI-tagged Maestro flows
mkdir -p apps/mobile/e2e/results-android
set +e
maestro test --include-tags ci apps/mobile/e2e/flows/ \
  --format junit \
  --output apps/mobile/e2e/results-android/results.xml
MAESTRO_EXIT=$?
set -e
echo "Maestro Android exit code: $MAESTRO_EXIT"
exit $MAESTRO_EXIT
