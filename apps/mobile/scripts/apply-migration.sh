#!/bin/bash

# Apply matchmaking auto-start fix migration
# This script directly applies the SQL to your Supabase database

echo "🚀 Applying matchmaking auto-start fix..."
echo ""

# Check if psql is available
if ! command -v psql &> /dev/null; then
    echo "❌ psql not found. Using curl instead..."
    echo ""
    echo "Please apply manually:"
    echo "1. Open: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql/new"
    echo "2. Copy: apps/mobile/supabase/migrations/20251228000001_fix_matchmaking_auto_start.sql"
    echo "3. Paste and run"
    exit 1
fi

# Read the migration file
MIGRATION_FILE="./supabase/migrations/20251228000001_fix_matchmaking_auto_start.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ Migration file not found: $MIGRATION_FILE"
    echo "Make sure you're running this from apps/mobile directory"
    exit 1
fi

echo "📄 Migration file: $MIGRATION_FILE"
echo ""

# Check for database URL
if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL environment variable not set"
    echo ""
    echo "Get your database URL:"
    echo "1. Open: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/settings/database"
    echo "2. Copy the Connection string (URI)"
    echo "3. Run: export DATABASE_URL='your_connection_string'"
    echo "4. Run this script again"
    echo ""
    echo "OR apply manually in Supabase Dashboard:"
    echo "https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql/new"
    exit 1
fi

echo "⏳ Applying migration..."
psql "$DATABASE_URL" -f "$MIGRATION_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration applied successfully!"
    echo ""
    echo "📝 Changes made:"
    echo "  1. ✅ Auto-start game when 4 players matched"
    echo "  2. ✅ Fixed 'already in room' error (code 23505)"
    echo "  3. ✅ All players navigate directly to GameScreen"
    echo "  4. ✅ Works for casual, ranked, and private matches"
    echo ""
    echo "🧪 Test now:"
    echo "  pnpm expo start --clear"
else
    echo ""
    echo "❌ Migration failed. Apply manually:"
    echo "https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql/new"
    exit 1
fi
