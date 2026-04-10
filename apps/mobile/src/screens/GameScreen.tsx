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

// P4-4 fix: ScoreboardProvider now receives enableLocalPersistence so it only
// writes score/play history to AsyncStorage in local-AI games.  Multiplayer
// games use the DB (game_state.scores_history / play_history) as the single
// source of truth to avoid stale-data race conditions on rejoin.
export default function GameScreen() {
  const route = useRoute<GameScreenRouteProp>();
  const { roomCode } = route.params;
  const isLocalAIGame = roomCode === 'LOCAL_AI_GAME';

  return (
    <GameEndProvider>
      <ScoreboardProvider enableLocalPersistence={isLocalAIGame}>
        <GameErrorBoundary>
          {isLocalAIGame ? <LocalAIGame /> : <MultiplayerGame />}
        </GameErrorBoundary>
      </ScoreboardProvider>
    </GameEndProvider>
  );
}
