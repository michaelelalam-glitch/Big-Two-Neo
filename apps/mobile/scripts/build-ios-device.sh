#!/bin/zsh
# Builds the dev client for a physical iPhone (local build — no EAS)
# The connected iPhone must be plugged in via USB before running this script.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "📱 Building Big Two dev client for physical iPhone..."
echo "   Project dir: $PROJECT_DIR"
echo "   Make sure your iPhone is connected via USB and trusted on this Mac."

cd "$PROJECT_DIR"

# Use UDID directly to avoid the interactive device prompt (which has a regex bug with device names containing parentheses).
# Your physical iPhone UDID: 00008030-00125430012B802E
DEVICE_UDID="00008030-00125430012B802E"

# Allow overriding UDID via first positional argument
if [[ -n "$1" ]]; then
  DEVICE_UDID="$1"
fi

# Use the local expo binary to avoid the deprecated global expo-cli
"$PROJECT_DIR/node_modules/.bin/expo" run:ios --device "$DEVICE_UDID"
