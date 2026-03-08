#!/bin/bash

# Fix Auto-Play Timer and Bot Replacement Race Condition
# Date: 2026-03-08
# Issue: [TurnTimer] ❌ Auto-play failed: Edge Function returned a non-2xx status code

set -e

echo "🚀 Deploying auto-play timer fix..."
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Fix Auto-Play Timer & Bot Replacement Race Condition${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Step 1: Apply SQL migration
echo -e "${YELLOW}📋 Step 1: Applying SQL migration...${NC}"
echo ""

if ! command -v supabase &> /dev/null; then
    echo -e "${RED}❌ Error: Supabase CLI not found${NC}"
    echo "Install it with: brew install supabase/tap/supabase"
    exit 1
fi

# Apply the migration
echo "Running migration: 20260308000004_fix_autoplay_bot_replacement_race.sql"
supabase db push --include-all

echo -e "${GREEN}✅ Migration applied successfully${NC}"
echo ""

# Step 2: Deploy edge function
echo -e "${YELLOW}🔧 Step 2: Deploying auto-play-turn edge function...${NC}"
echo ""

supabase functions deploy auto-play-turn --no-verify-jwt

echo -e "${GREEN}✅ Edge function deployed successfully${NC}"
echo ""

# Step 3: Summary
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "What was fixed:"
echo ""
echo "1. ${GREEN}Auto-play timer now works correctly${NC}"
echo "   - Fixed race condition between timer expiry and bot replacement"
echo "   - Auto-play can execute even if player is being replaced"
echo ""
echo "2. ${GREEN}Bot replacement respects active turns${NC}"
echo "   - Won't replace player if their turn timer is still active"
echo "   - 10-second buffer allows auto-play to execute first"
echo ""
echo "3. ${GREEN}Edge function uses human_user_id${NC}"
echo "   - Can verify player identity even after bot replacement"
echo "   - Proper authorization for disconnected players"
echo ""
echo -e "${YELLOW}⚠️  Test the fix:${NC}"
echo "   1. Start a game"
echo "   2. Wait for turn timer to expire (60s)"
echo "   3. Auto-play should execute successfully"
echo "   4. No more 'non-2xx status code' errors"
echo ""
