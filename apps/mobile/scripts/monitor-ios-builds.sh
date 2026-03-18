#!/bin/bash
# Monitor simulator install and device build/install for Big2Mobile
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

SIM_BUNDLE="com.big2mobile.app"
DEVICE_LOG="$PROJECT_DIR/.expo/xcodebuild.log"

# Locate the DerivedData directory for Big2Mobile dynamically so this script
# works on any machine without committing a user/hash-specific path.
_derived_root="${DERIVED_DATA_DIR:-$HOME/Library/Developer/Xcode/DerivedData}"
_derived=$(find "$_derived_root" -maxdepth 1 -type d -name "Big2Mobile-*" 2>/dev/null | head -1)
SIM_APP_PATH="${_derived}/Build/Products/Debug-iphonesimulator/Big2Mobile.app"
DEV_APP_PATH="${_derived}/Build/Products/Debug-iphoneos/Big2Mobile.app"
INTERVAL=15
TIMEOUT_SECS=$((60*60)) # 60 minutes max
END=$((SECONDS+TIMEOUT_SECS))

echo "[monitor] starting: will check every ${INTERVAL}s up to ${TIMEOUT_SECS}s"
while [ $SECONDS -lt $END ]; do
  TIMESTAMP=$(date +"%Y-%m-%dT%H:%M:%S")
  SIM_INSTALLED=$(xcrun simctl listapps booted 2>/dev/null | grep -c "$SIM_BUNDLE" || true)
  DEVICE_BUILD=0
  DEVICE_INSTALLED=0
  if [ -f "$DEVICE_LOG" ]; then
    if grep -qi "installation succeeded" "$DEVICE_LOG" 2>/dev/null || grep -q "INSTALLATION SUCCEEDED" "$DEVICE_LOG" 2>/dev/null; then
      DEVICE_INSTALLED=1
    fi
    if grep -q "BUILD SUCCEEDED" "$DEVICE_LOG" 2>/dev/null; then
      DEVICE_BUILD=1
    fi
  fi
  PERC=0
  if [ -e "$SIM_APP_PATH" ]; then PERC=$((PERC+40)); fi
  if [ -e "$DEV_APP_PATH" ]; then PERC=$((PERC+40)); fi
  if [ "$SIM_INSTALLED" -ge 1 ]; then PERC=$((PERC+10)); fi
  if [ "$DEVICE_INSTALLED" -eq 1 ]; then PERC=$((PERC+10)); fi

  echo "[$TIMESTAMP] sim_installed:$SIM_INSTALLED device_build:$DEVICE_BUILD device_installed:$DEVICE_INSTALLED progress:${PERC}%"

  if [ "$SIM_INSTALLED" -ge 1 ] && [ "$DEVICE_INSTALLED" -eq 1 ]; then
    echo "[monitor] COMPLETE: both simulator and device installed"
    exit 0
  fi
  sleep $INTERVAL
done

echo "[monitor] TIMED OUT after ${TIMEOUT_SECS}s"
exit 2
