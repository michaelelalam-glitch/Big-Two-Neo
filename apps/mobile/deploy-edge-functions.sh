#!/bin/bash

# RPC to Edge Function Migration - Deployment Script
# This script deploys all newly created Edge Functions to Supabase

set -e  # Exit on error

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Error: Supabase CLI not found!"
    echo "Please install it: https://supabase.com/docs/guides/cli"
    exit 1
fi

echo "🚀 Deploying Edge Functions to Supabase..."
echo ""

# Change to mobile app directory (based on this script's location)
cd "$(dirname "$0")"

echo "📍 Current directory: $(pwd)"
echo ""

# Use environment variable or default project reference
PROJECT_REF="${SUPABASE_PROJECT_REF:-dppybucldqufbqhwnkxu}"
echo "🔧 Using Supabase project reference: ${PROJECT_REF}"
echo ""

# Connection Management Functions
echo "📦 Deploying Connection Management Functions..."
supabase functions deploy update-heartbeat --project-ref "${PROJECT_REF}"
supabase functions deploy mark-disconnected --project-ref "${PROJECT_REF}"
supabase functions deploy reconnect-player --project-ref "${PROJECT_REF}"
echo "✅ Connection management functions deployed"
echo ""

# Matchmaking Functions
echo "📦 Deploying Matchmaking Functions..."
supabase functions deploy find-match --project-ref "${PROJECT_REF}"
supabase functions deploy cancel-matchmaking --project-ref "${PROJECT_REF}"
echo "✅ Matchmaking functions deployed"
echo ""

# Utility Functions
echo "📦 Deploying Utility Functions..."
supabase functions deploy server-time --project-ref "${PROJECT_REF}"
supabase functions deploy delete-account --project-ref "${PROJECT_REF}"
echo "✅ Utility functions deployed"
echo ""

# Previously Existing Functions (for completeness)
echo "📦 Redeploying Existing Functions (optional)..."
echo "Skipping play-cards, player-pass, start_new_match, complete-game, send-push-notification"
echo "(These were already deployed previously)"
echo ""

echo "🎉 All Edge Functions deployed successfully!"
echo ""
echo "Next steps:"
echo "1. Test connection management: update-heartbeat, mark-disconnected, reconnect-player"
echo "2. Test matchmaking: find-match, cancel-matchmaking"
echo "3. Test utilities: server-time, delete-account"
echo "4. Run integration tests"
echo ""
echo "📖 See docs/RPC_TO_EDGE_FUNCTION_MIGRATION_COMPLETE_DEC_31_2025.md for details"
