import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '../contexts/AuthContext';
import { NotificationProvider } from '../contexts/NotificationContext';
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
import RankedLeaderboardScreen from '../screens/RankedLeaderboardScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SignInScreen from '../screens/SignInScreen';
import StatsScreen from '../screens/StatsScreen';

export type RootStackParamList = {
  GameSelection: undefined;
  Home: undefined;
  SignIn: undefined;
  Profile: undefined;
  CreateRoom: undefined;
  JoinRoom: undefined;
  MatchTypeSelection: undefined;
  Matchmaking: { matchType?: 'casual' | 'ranked' };
  Lobby: { roomCode: string };
  Game: { roomCode: string; forceNewGame?: boolean; botDifficulty?: 'easy' | 'medium' | 'hard' };
  Leaderboard: undefined;
  RankedLeaderboard: undefined;
  MatchHistory: undefined;
  Stats: { userId?: string };
  NotificationSettings: undefined;
  Settings: undefined;
  HowToPlay: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

function LoadingScreen() {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#4A90E2" />
    </View>
  );
}

export default function AppNavigator() {
  const { isLoading, isLoggedIn } = useAuth();

  // Log navigation state for debugging
  React.useEffect(() => {
    console.log('📱 [AppNavigator] State:', { isLoading, isLoggedIn });
    console.log('📱 [AppNavigator] Will render:', isLoggedIn ? 'App Stack (Home)' : 'Auth Stack (SignIn)');
  }, [isLoading, isLoggedIn]);

  if (isLoading) {
    console.log('⏳ [AppNavigator] Loading...');
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer>
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
              <Stack.Screen name="RankedLeaderboard" component={RankedLeaderboardScreen} />
              <Stack.Screen name="MatchHistory" component={MatchHistoryScreen} />
              <Stack.Screen name="Stats" component={StatsScreen} />
              <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="HowToPlay" component={HowToPlayScreen} />
            </>
          )}
        </Stack.Navigator>
      </NotificationProvider>
    </NavigationContainer>
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
