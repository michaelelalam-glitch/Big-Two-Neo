#!/bin/bash
set -e

echo "🔧 Applying turn timer fix..."
echo ""

# Get Supabase connection string from environment or config
PROJECT_REF=$(grep 'project_id' supabase/config.toml 2>/dev/null | cut -d'"' -f2 || echo "")

if [ -z "$PROJECT_REF" ]; then
  echo "❌ Could not find project_id in supabase/config.toml"
  echo "Please run this manually:"
  echo ""
  echo "  npx supabase db execute --file fix-turn-timer-now.sql"
  echo ""
  exit 1
fi

# Apply the fix
npx supabase db execute --file fix-turn-timer-now.sql

echo ""
echo "✅ Turn timer fix applied successfully!"
echo "🎮 You can now test autoplay - it should trigger after 60 seconds of inactivity"
