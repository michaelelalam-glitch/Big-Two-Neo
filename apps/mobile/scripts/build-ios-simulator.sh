#!/bin/zsh
# Builds the dev client for iOS simulator (local build — no EAS)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "📱 Building Big Two dev client for iOS Simulator..."
echo "   Project dir: $PROJECT_DIR"

cd "$PROJECT_DIR"

# Use the local expo binary to avoid the deprecated global expo-cli
"$PROJECT_DIR/node_modules/.bin/expo" run:ios "$@"
