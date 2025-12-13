#!/bin/bash
#########################################################################
# WARNING: This script is intended to be run ONCE during migration only.
# It modifies generated test files in-place to fix up props and imports.
# Do NOT run this as part of regular development or CI.
# 
# This script is fragile and should be deleted after migration.
#########################################################################

# This script is made portable for both macOS and Linux by using a backup
# extension with sed (-i.bak), then removing the .bak files at the end.

# Add playHistory={[]} to all CompactScoreboard components in tests
sed -i.bak 's/<CompactScoreboard$/<CompactScoreboard playHistory={[]}/g' src/components/scoreboard/__tests__/ScoreboardComponents.test.tsx

# Add missing props to ExpandedScoreboard
sed -i.bak 's/<ExpandedScoreboard$/<ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}/g' src/components/scoreboard/__tests__/ScoreboardComponents.test.tsx

# Fix ScoreboardContext import paths (it's in ../../../contexts/, not ../../../../contexts/)
sed -i.bak "s|import { ScoreboardProvider, useScoreboard } from '../../../contexts/ScoreboardContext';|import { ScoreboardProvider, useScoreboard } from '../../ScoreboardContext';|g" src/contexts/__tests__/ScoreboardContext.test.tsx

# Fix types import path
sed -i.bak "s|import { ScoreHistory, PlayHistoryMatch, Card } from '../../../types/scoreboard';|import { ScoreHistory, PlayHistoryMatch, Card } from '../../types/scoreboard';|g" src/contexts/__tests__/ScoreboardContext.test.tsx

# Fix integration test Card typing
sed -i.bak "s|const mockCard = (rank: string, suit: string): Card => ({|const mockCard = (rank: Card['rank'], suit: Card['suit']): Card => ({|g" src/components/scoreboard/__tests__/ScoreboardIntegration.test.tsx

# Add missing props to ScoreboardContainer in integration tests
find src/components/scoreboard/__tests__/ScoreboardIntegration.test.tsx -type f -exec sed -i.bak 's|<ScoreboardContainer$|<ScoreboardContainer scoreHistory={[]} playHistory={[]}|g' {} \;

# Remove all .bak files created by sed
find src -name "*.bak" -type f -delete

echo "Test files fixed. This script should be deleted after migration is complete."

