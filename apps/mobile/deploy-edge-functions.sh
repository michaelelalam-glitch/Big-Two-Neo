#!/bin/bash

# RPC to Edge Function Migration - Deployment Script
# This script deploys all newly created Edge Functions to Supabase

set -e  # Exit on error

echo "🚀 Deploying Edge Functions to Supabase..."
echo ""

# Change to mobile app directory
cd "$(dirname "$0")/../apps/mobile"

echo "📍 Current directory: $(pwd)"
echo ""

# Connection Management Functions
echo "📦 Deploying Connection Management Functions..."
supabase functions deploy update-heartbeat --project-ref dppybucldqufbqhwnkxu
supabase functions deploy mark-disconnected --project-ref dppybucldqufbqhwnkxu
supabase functions deploy reconnect-player --project-ref dppybucldqufbqhwnkxu
echo "✅ Connection management functions deployed"
echo ""

# Matchmaking Functions
echo "📦 Deploying Matchmaking Functions..."
supabase functions deploy find-match --project-ref dppybucldqufbqhwnkxu
supabase functions deploy cancel-matchmaking --project-ref dppybucldqufbqhwnkxu
echo "✅ Matchmaking functions deployed"
echo ""

# Utility Functions
echo "📦 Deploying Utility Functions..."
supabase functions deploy server-time --project-ref dppybucldqufbqhwnkxu
supabase functions deploy delete-account --project-ref dppybucldqufbqhwnkxu
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
