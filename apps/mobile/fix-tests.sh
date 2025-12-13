#!/bin/bash

# Add playHistory={[]} to all CompactScoreboard components in tests
sed -i '' 's/<CompactScoreboard$/<CompactScoreboard playHistory={[]}/g' src/components/scoreboard/__tests__/ScoreboardComponents.test.tsx

# Add missing props to ExpandedScoreboard
sed -i '' 's/<ExpandedScoreboard$/<ExpandedScoreboard playHistory={[]} isExpanded={false} cardCounts={mockCardCounts} currentPlayerIndex={0}/g' src/components/scoreboard/__tests__/ScoreboardComponents.test.tsx

# Fix ScoreboardContext import paths (it's in ../../../contexts/, not ../../../../contexts/)
sed -i '' "s|import { ScoreboardProvider, useScoreboard } from '../../../contexts/ScoreboardContext';|import { ScoreboardProvider, useScoreboard } from '../../ScoreboardContext';|g" src/contexts/__tests__/ScoreboardContext.test.tsx

# Fix types import path
sed -i '' "s|import { ScoreHistory, PlayHistoryMatch, Card } from '../../../types/scoreboard';|import { ScoreHistory, PlayHistoryMatch, Card } from '../../types/scoreboard';|g" src/contexts/__tests__/ScoreboardContext.test.tsx

# Fix integration test Card typing
sed -i '' "s|const mockCard = (rank: string, suit: string): Card => ({|const mockCard = (rank: Card['rank'], suit: Card['suit']): Card => ({|g" src/components/scoreboard/__tests__/ScoreboardIntegration.test.tsx

# Add missing props to ScoreboardContainer in integration tests
find src/components/scoreboard/__tests__/ScoreboardIntegration.test.tsx -type f -exec sed -i '' 's|<ScoreboardContainer$|<ScoreboardContainer scoreHistory={[]} playHistory={[]}|g' {} \;

