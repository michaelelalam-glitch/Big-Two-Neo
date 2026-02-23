import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';

type GameSelectionNavigationProp = StackNavigationProp<RootStackParamList, 'GameSelection'>;

export default function GameSelectionScreen() {
  const navigation = useNavigation<GameSelectionNavigationProp>();
  const { profile, user } = useAuth();

  const handleChinesePoker = () => {
    navigation.replace('Home');
  };

  const handleLebaneseDeal = () => {
    Alert.alert(
      '🚧 Coming Soon!',
      'Lebanese Deal is currently in development. Stay tuned!',
      [{ text: 'OK', style: 'default' }]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>
          Welcome, {profile?.username || user?.email?.split('@')[0] || 'Player'}!
        </Text>
        <Text style={styles.headerSubtitle}>Choose a game to play</Text>
      </View>

      <View style={styles.content}>
        {/* Chinese Poker Card */}
        <TouchableOpacity
          style={[styles.gameCard, styles.chinesePokerCard]}
          onPress={handleChinesePoker}
          activeOpacity={0.85}
        >
          <View style={styles.gameCardInner}>
            <Text style={styles.gameEmoji}>🀄</Text>
            <View style={styles.gameInfo}>
              <Text style={styles.gameTitle}>Chinese Poker</Text>
              <Text style={styles.gameDescription}>
                Big Two — the classic card game.{'\n'}Play online or against bots.
              </Text>
            </View>
            <View style={styles.playBadge}>
              <Text style={styles.playBadgeText}>PLAY →</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Lebanese Deal Card */}
        <TouchableOpacity
          style={[styles.gameCard, styles.lebaneseDealCard]}
          onPress={handleLebaneseDeal}
          activeOpacity={0.85}
        >
          <View style={styles.gameCardInner}>
            <Text style={styles.gameEmoji}>🃏</Text>
            <View style={styles.gameInfo}>
              <Text style={styles.gameTitle}>Lebanese Deal</Text>
              <Text style={styles.gameDescription}>
                A brand-new card game experience.{'\n'}Stay tuned for the launch!
              </Text>
            </View>
            <View style={[styles.playBadge, styles.comingSoonBadge]}>
              <Text style={[styles.playBadgeText, styles.comingSoonBadgeText]}>SOON</Text>
            </View>
          </View>
          {/* Overlay to visually indicate disabled */}
          <View style={styles.comingSoonOverlay}>
            <Text style={styles.comingSoonLabel}>Coming Soon</Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>More games coming in future updates</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.lg,
    alignItems: 'center',
  },
  greeting: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    justifyContent: 'center',
    gap: SPACING.lg,
  },
  gameCard: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  chinesePokerCard: {
    backgroundColor: '#1e3a5f',
    borderWidth: 1,
    borderColor: COLORS.secondary,
  },
  lebaneseDealCard: {
    backgroundColor: '#1c1f24',
    borderWidth: 1,
    borderColor: COLORS.gray.dark,
  },
  gameCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  gameEmoji: {
    fontSize: 48,
  },
  gameInfo: {
    flex: 1,
  },
  gameTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.xs,
  },
  gameDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
    lineHeight: 20,
  },
  playBadge: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 8,
  },
  playBadgeText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  comingSoonBadge: {
    backgroundColor: COLORS.gray.dark,
  },
  comingSoonBadgeText: {
    color: COLORS.gray.medium,
  },
  comingSoonOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(255, 152, 0, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.warning,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  comingSoonLabel: {
    color: COLORS.warning,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  footer: {
    paddingBottom: SPACING.xl,
    alignItems: 'center',
  },
  footerText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.gray.dark,
    textAlign: 'center',
  },
});
