import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;

export default function GameScreen() {
  const route = useRoute<GameScreenRouteProp>();
  const { roomCode } = route.params;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Game Screen</Text>
        <Text style={styles.subtitle}>Room: {roomCode}</Text>
        <Text style={styles.description}>
          🚧 Game UI coming soon! 🚧
        </Text>
        <Text style={styles.info}>
          This screen will contain the actual Big2 card game interface with:
          {'\n'}- Your hand of cards
          {'\n'}- Other players' positions
          {'\n'}- Play area
          {'\n'}- Game controls
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.md,
  },
  subtitle: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.gray.medium,
    marginBottom: SPACING.xl,
  },
  description: {
    fontSize: FONT_SIZES.xl,
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  info: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.light,
    textAlign: 'center',
    lineHeight: 24,
  },
});
