/**
 * GameScreen - Simple router component that picks the correct game mode.
 * Task #570: Split GameScreen from 808 lines → ~30 line router.
 *
 * Architecture:
 *   GameScreen (this file)  – providers + mode routing
 *   ├── LocalAIGame.tsx     – all local-only hooks + renders GameView
 *   ├── MultiplayerGame.tsx – all multiplayer hooks + renders GameView
 *   └── GameView.tsx        – shared presentation (portrait, landscape, modals)
 */
import React from 'react';
import { useRoute, RouteProp } from '@react-navigation/native';
import { GameEndProvider } from '../contexts/GameEndContext';
import { ScoreboardProvider } from '../contexts/ScoreboardContext';
import { GameErrorBoundary } from '../components/game/GameErrorBoundary';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { LocalAIGame } from './LocalAIGame';
import { MultiplayerGame } from './MultiplayerGame';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;

function GameScreenRouter() {
  const route = useRoute<GameScreenRouteProp>();
  const { roomCode } = route.params;
  const isLocalAIGame = roomCode === 'LOCAL_AI_GAME';

  return (
    <GameErrorBoundary>{isLocalAIGame ? <LocalAIGame /> : <MultiplayerGame />}</GameErrorBoundary>
  );
}

// Wrapper component with ScoreboardProvider and GameEndProvider
export default function GameScreen() {
  return (
    <GameEndProvider>
      <ScoreboardProvider>
        <GameScreenRouter />
      </ScoreboardProvider>
    </GameEndProvider>
  );
}
