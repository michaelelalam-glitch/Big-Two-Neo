#!/bin/bash

# ===================================================================
# Apply Turn Inactivity Timer Migrations
# ===================================================================
# This script applies the migrations needed for the 60s turn timer:
# 1. add_turn_inactivity_timer.sql - Adds turn_started_at column + trigger
# 2. fix_turn_started_at_on_game_creation.sql - Fixes game creation to set turn_started_at

set -e

echo "🔧 Applying turn inactivity timer migrations..."
echo ""

cd "$(dirname "$0")"
cd apps/mobile

# Check if supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "❌ Error: Supabase CLI not found. Install it first:"
    echo "   npm i -g supabase"
    exit 1
fi

# Check if we're linked to a project
if [ ! -f .supabase/config.toml ]; then
    echo "❌ Error: Not linked to a Supabase project"
    echo "   Run: supabase link"
    exit 1
fi

# Apply migrations in order
echo "📝 Applying migration: 20260308000002_add_turn_inactivity_timer.sql"
supabase db execute --file supabase/migrations/20260308000002_add_turn_inactivity_timer.sql

echo "📝 Applying migration: 20260308000003_fix_turn_started_at_on_game_creation.sql"
supabase db execute --file supabase/migrations/20260308000003_fix_turn_started_at_on_game_creation.sql

echo ""
echo "✅ Migrations applied successfully!"
echo ""
echo "Next steps:"
echo "1. Restart your app/server"
echo "2. Start a NEW multiplayer game"
echo "3. Verify the charcoal grey ring appears and depletes over 60s"
echo "4. Wait for auto-play to execute"
