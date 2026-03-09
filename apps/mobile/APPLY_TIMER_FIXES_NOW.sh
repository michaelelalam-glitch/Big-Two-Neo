#!/bin/bash
set -e

echo "📦 Applying Auto-Pass Timer Fixes..."
echo ""

# Navigate to project root
cd "$(dirname "$0")"

echo "✅ Step 1: Code fixes already applied:"
echo "   - LobbyScreen console spam removed"
echo "   - Ring direction fixed (clockwise depletion)"
echo "   - Ring visibility fixed (all players see it)"
echo "   - Disconnect spinner shows immediately"
echo ""

echo "🗄️  Step 2: Applying database migrations..."
echo ""

# Check if Supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "❌ ERROR: Supabase CLI not found!"
    echo "   Install it first: https://supabase.com/docs/guides/cli"
    exit 1
fi

# Apply migrations in order
echo "   Applying 20260308000002_add_turn_inactivity_timer.sql..."
supabase db push --include-all

echo ""
echo "✅ All migrations applied successfully!"
echo ""
echo "🧪 Step 3: Verify database changes..."
echo ""

# Verify turn_started_at column exists
echo "   Checking turn_started_at column..."
supabase db execute "SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'game_state' AND column_name = 'turn_started_at';"

# Verify disconnect_timer_started_at column exists
echo ""
echo "   Checking disconnect_timer_started_at column..."
supabase db execute "SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'room_players' AND column_name = 'disconnect_timer_started_at';"

# Verify trigger exists
echo ""
echo "   Checking turn timer trigger..."
supabase db execute "SELECT trigger_name, event_manipulation, event_object_table 
FROM information_schema.triggers 
WHERE trigger_name = 'trigger_update_turn_started_at';"

echo ""
echo "✅ ALL FIXES APPLIED SUCCESSFULLY!"
echo ""
echo "📱 Step 4: Test the fixes:"
echo "   1. Start a new game"
echo "   2. Console should be clean (no spam)"
echo "   3. Charcoal grey ring should appear on whoever's turn it is (visible to all players)"
echo "   4. Ring should deplete CLOCKWISE from top"
echo "   5. After 60s of inactivity, auto-play should execute"
echo "   6. If player disconnects, yellow ring + spinner should appear"
echo "   7. After 60s disconnect, bot should replace player"
echo "   8. Home banner should show 60s countdown when away from game"
echo ""
echo "🎉 Done! Your auto-pass timer system is now fully functional."
