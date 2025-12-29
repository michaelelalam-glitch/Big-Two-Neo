#!/bin/bash
# Apply critical SQL migration to fix start_game_with_bots
# This MUST be run before deploying the updated LobbyScreen code

echo "🔧 Applying migration: fix_start_game_with_bots_room_status"
echo "⚠️  This fixes the critical bug where players go to different game rooms"
echo ""

# Read the Supabase project ref from git remote or environment
PROJECT_REF="rygcydcrohgaqlrjkiob"

echo "📊 Project: $PROJECT_REF"
echo ""
echo "Please run this command manually in your Supabase SQL Editor:"
echo "https://supabase.com/dashboard/project/$PROJECT_REF/sql/new"
echo ""
echo "=== COPY EVERYTHING BELOW THIS LINE ==="
cat supabase/migrations/20251226000001_fix_start_game_with_bots_room_status.sql
echo ""
echo "=== END OF SQL ==="
echo ""
echo "Or use: npx supabase db push (if you have local Supabase CLI configured)"
