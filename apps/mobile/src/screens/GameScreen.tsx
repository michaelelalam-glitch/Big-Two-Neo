/**
 * GameScreen - Simple router for game modes
 * 
 * Routes to:
 * - LocalAIGameScreen (roomCode === 'LOCAL_AI_GAME')
 * - MultiplayerGameScreen (all other room codes)
 * 
 * Task #570: Split 1,366-line GameScreen into organized components
 */

import React from 'react';
import { useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../contexts/AuthContext';
import { ScoreboardProvider } from '../contexts/ScoreboardContext';
import { GameEndProvider } from '../contexts/GameEndContext';
import { GameEndModal, GameEndErrorBoundary } from '../components/gameEnd';
import { LocalAIGameScreen } from './game/LocalAIGameScreen';
import { MultiplayerGameScreen } from './game/MultiplayerGameScreen';
import { gameLogger } from '../utils/logger';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;

function GameScreenContent() {
  const route = useRoute<GameScreenRouteProp>();
  const { roomCode } = route.params;
  
  // Detect game mode
  const isLocalAIGame = roomCode === 'LOCAL_AI_GAME';
  
  gameLogger.info(`🎮 [GameScreen] Routing to: ${isLocalAIGame ? 'LocalAIGameScreen' : 'MultiplayerGameScreen'}`);

  // Route to appropriate game screen
  if (isLocalAIGame) {
    return <LocalAIGameScreen />;
  } else {
    return <MultiplayerGameScreen />;
  }
}

/**
 * GameScreen - Wrapped with providers
 */
export default function GameScreen() {
  return (
    <ScoreboardProvider>
      <GameEndProvider>
        <GameEndErrorBoundary>
          <GameScreenContent />
          <GameEndModal />
        </GameEndErrorBoundary>
      </GameEndProvider>
    </ScoreboardProvider>
  );
}
