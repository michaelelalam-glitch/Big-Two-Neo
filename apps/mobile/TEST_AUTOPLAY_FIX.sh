#!/bin/bash

# Test Auto-Play Timer Fix
# This script helps troubleshoot auto-play timer issues

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Auto-Play Timer Debug & Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Get the project ref
PROJECT_REF="dppybucldqufbqhwnkxu"

echo -e "${YELLOW}📋 Testing auto-play timer fix...${NC}"
echo ""

# Step 1: Check if function is deployed
echo -e "${BLUE}Step 1: Checking if auto-play-turn is deployed...${NC}"
if supabase functions list --project-ref "$PROJECT_REF" | grep -q "auto-play-turn"; then
    echo -e "${GREEN}✅ auto-play-turn function is deployed${NC}"
else
    echo -e "${RED}❌ auto-play-turn function not found${NC}"
    echo "Run: supabase functions deploy auto-play-turn --project-ref $PROJECT_REF"
    exit 1
fi
echo ""

# Step 2: Check database function
echo -e "${BLUE}Step 2: Checking process_disconnected_players function...${NC}"
FUNCTION_CHECK=$(supabase db execute --project-ref "$PROJECT_REF" --sql "SELECT COUNT(*) as count FROM pg_proc WHERE proname = 'process_disconnected_players'" --output json | jq -r '.[0].count' 2>/dev/null || echo "0")

if [ "$FUNCTION_CHECK" = "1" ]; then
    echo -e "${GREEN}✅ Database function exists${NC}"
else
    echo -e "${RED}❌ Database function not found${NC}"
    echo "Run: supabase db push --include-all"
    exit 1
fi
echo ""

# Step 3: Show recent function logs
echo -e "${BLUE}Step 3: Recent auto-play-turn logs (last 10 minutes)...${NC}"
echo ""
echo "To view live logs, run:"
echo -e "${YELLOW}    supabase functions logs auto-play-turn --project-ref $PROJECT_REF${NC}"
echo ""

# Step 4: Testing instructions
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Setup Complete! Ready to Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}How to test:${NC}"
echo ""
echo "1. Start a game in the app"
echo "2. On your turn, wait for the full 60 seconds without playing"
echo "3. Watch the console for:"
echo "   ${GREEN}✅ [TurnTimer] EXPIRED — triggering auto-play${NC}"
echo "   ${GREEN}✅ [TurnTimer] Calling auto-play-turn edge function${NC}"
echo "   ${GREEN}✅ [TurnTimer] ✅ Auto-play successful${NC}"
echo ""
echo "4. Check for errors:"
echo "   ${RED}❌ If you see 'Edge Function returned a non-2xx status code'${NC}"
echo "   Run: ${BLUE}supabase functions logs auto-play-turn --project-ref $PROJECT_REF${NC}"
echo "   Look for the detailed error logs"
echo ""
echo -e "${YELLOW}Debug logs will show:${NC}"
echo "   • Auth check: user ID, player_user_id, human_user_id"
echo "   • Effective user ID being used"
echo "   • Whether turn authorization passed"
echo "   • Card play or pass action"
echo ""
echo -e "${YELLOW}View logs in real-time:${NC}"
echo "   ${BLUE}supabase functions logs auto-play-turn --project-ref $PROJECT_REF --follow${NC}"
echo ""
echo -e "${YELLOW}View database logs:${NC}"
echo "   Go to: https://supabase.com/dashboard/project/$PROJECT_REF/logs/postgres-logs"
echo ""
