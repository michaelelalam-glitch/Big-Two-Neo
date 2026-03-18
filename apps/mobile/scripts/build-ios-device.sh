#!/bin/zsh
# Builds the dev client for a physical iPhone (local build — no EAS)
# The connected iPhone must be plugged in via USB before running this script.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "📱 Building Big Two dev client for physical iPhone..."
echo "   Project dir: $PROJECT_DIR"
echo "   Make sure your iPhone is connected via USB and trusted on this Mac."

cd "$PROJECT_DIR"

# Accept UDID via first postiional argument or DEVICE_UDID env var.
# If neither is set, pass --device without a value so Expo prompts interactively.
# Avoid committing a hard-coded device UDID (Copilot PR-151 r2951116791).
if [[ -n "$1" ]]; then
  DEVICE_ARG="${1}"
elif [[ -n "$DEVICE_UDID" ]]; then
  DEVICE_ARG="${DEVICE_UDID}"
fi

# Use the local expo binary to avoid the deprecated global expo-cli
if [[ -n "$DEVICE_ARG" ]]; then
  "$PROJECT_DIR/node_modules/.bin/expo" run:ios --device "$DEVICE_ARG"
else
  echo "   No UDID provided — Expo will prompt to select a connected device."
  "$PROJECT_DIR/node_modules/.bin/expo" run:ios --device
fi
