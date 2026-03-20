import React from 'react';
import { View, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import type { LinkingOptions } from '@react-navigation/native';
import { GlobalErrorBoundary } from '../components/GlobalErrorBoundary';
import { useAuth } from '../contexts/AuthContext';
import { NotificationProvider } from '../contexts/NotificationContext';
import { FriendsProvider } from '../contexts/FriendsContext';
import CreateRoomScreen from '../screens/CreateRoomScreen';
import GameScreen from '../screens/GameScreen';
import GameSelectionScreen from '../screens/GameSelectionScreen';
import HomeScreen from '../screens/HomeScreen';
import HowToPlayScreen from '../screens/HowToPlayScreen';
import JoinRoomScreen from '../screens/JoinRoomScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import LobbyScreen from '../screens/LobbyScreen';
import MatchHistoryScreen from '../screens/MatchHistoryScreen';
import MatchmakingScreen from '../screens/MatchmakingScreen';
import MatchTypeSelectionScreen from '../screens/MatchTypeSelectionScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SignInScreen from '../screens/SignInScreen';
import StatsScreen from '../screens/StatsScreen';
import { authLogger } from '../utils/logger';

export type RootStackParamList = {
  GameSelection: undefined;
  Home: undefined;
  SignIn: undefined;
  Profile: undefined;
  CreateRoom: undefined;
  JoinRoom: undefined;
  MatchTypeSelection: undefined;
  Matchmaking: { matchType?: 'casual' | 'ranked' };
  Lobby: { roomCode: string; playAgain?: boolean };
  Game: { roomCode: string; forceNewGame?: boolean; botDifficulty?: 'easy' | 'medium' | 'hard' };
  Leaderboard: undefined;
  MatchHistory: undefined;
  Stats: { userId?: string };
  NotificationSettings: undefined;
  Settings: undefined;
  HowToPlay: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

/**
 * Deep linking configuration.
 *
 * Supported URL schemes:
 *   big2://lobby/<roomCode>       → opens Lobby screen directly
 *   big2://game/<roomCode>        → opens Game/rejoin screen
 *   https://big2.app/lobby/<code> → universal link (same)
 *
 * Android: requires intent-filter with big2:// in AndroidManifest.xml
 * iOS: requires CFBundleURLSchemes entry in Info.plist + associated domain for https
 */
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['big2://', 'https://big2.app'],
  config: {
    screens: {
      // Auth stack (covers logged-out deep links so they aren’t silently dropped)
      SignIn: 'signin',
      // App stack
      Lobby: 'lobby/:roomCode',
      Game: 'game/:roomCode',
      JoinRoom: 'join',
      Home: 'home',
      Profile: 'profile',
      Leaderboard: 'leaderboard',
    },
  },
  async getInitialURL() {
    const url = await Linking.getInitialURL();
    return url ?? undefined;
  },
  subscribe(listener) {
    const sub = Linking.addEventListener('url', ({ url }) => listener(url));
    return () => sub.remove();
  },
};

function LoadingScreen() {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#4A90E2" />
    </View>
  );
}

export default function AppNavigator() {
  const { isLoading, isLoggedIn } = useAuth();
  const pendingLinkRef = React.useRef<string | null>(null);

  // Log navigation state for debugging
  React.useEffect(() => {
    authLogger.info('📱 [AppNavigator] State:', { isLoading, isLoggedIn });
    authLogger.info(
      '📱 [AppNavigator] Will render:',
      isLoggedIn ? 'App Stack (Home)' : 'Auth Stack (SignIn)'
    );
  }, [isLoading, isLoggedIn]);

  // When a deep link arrives while the user is logged out, store it so it
  // can be replayed once the authenticated stack is mounted.
  React.useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (!isLoggedIn) {
        pendingLinkRef.current = url;
      }
    });
    return () => sub.remove();
  }, [isLoggedIn]);

  // After sign-in, re-open any stored pending link so React Navigation's
  // linking middleware can route the user to the intended screen.
  React.useEffect(() => {
    if (isLoggedIn && pendingLinkRef.current) {
      const url = pendingLinkRef.current;
      pendingLinkRef.current = null;
      // Small delay to let the authenticated stack finish mounting.
      setTimeout(() => Linking.openURL(url), 300);
    }
  }, [isLoggedIn]);

  if (isLoading) {
    authLogger.info('⏳ [AppNavigator] Loading...');
    return <LoadingScreen />;
  }

  return (
    <GlobalErrorBoundary>
      <NavigationContainer linking={linking}>
        <FriendsProvider>
          <NotificationProvider>
            <Stack.Navigator
              screenOptions={{
                headerShown: false,
              }}
            >
              {!isLoggedIn ? (
                // Auth Stack
                <Stack.Screen name="SignIn" component={SignInScreen} />
              ) : (
                // App Stack
                <>
                  <Stack.Screen name="GameSelection" component={GameSelectionScreen} />
                  <Stack.Screen name="Home" component={HomeScreen} />
                  <Stack.Screen name="Profile" component={ProfileScreen} />
                  <Stack.Screen name="CreateRoom" component={CreateRoomScreen} />
                  <Stack.Screen name="JoinRoom" component={JoinRoomScreen} />
                  <Stack.Screen name="MatchTypeSelection" component={MatchTypeSelectionScreen} />
                  <Stack.Screen name="Matchmaking" component={MatchmakingScreen} />
                  <Stack.Screen name="Lobby" component={LobbyScreen} />
                  <Stack.Screen name="Game" component={GameScreen} />
                  <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
                  <Stack.Screen name="MatchHistory" component={MatchHistoryScreen} />
                  <Stack.Screen name="Stats" component={StatsScreen} />
                  <Stack.Screen
                    name="NotificationSettings"
                    component={NotificationSettingsScreen}
                  />
                  <Stack.Screen name="Settings" component={SettingsScreen} />
                  <Stack.Screen name="HowToPlay" component={HowToPlayScreen} />
                </>
              )}
            </Stack.Navigator>
          </NotificationProvider>
        </FriendsProvider>
      </NavigationContainer>
    </GlobalErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#25292e',
  },
});
