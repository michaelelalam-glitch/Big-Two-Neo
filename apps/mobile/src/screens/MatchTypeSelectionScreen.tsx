import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';

type MatchTypeSelectionNavigationProp = StackNavigationProp<RootStackParamList, 'Home'>;

/**
 * Match Type Selection Screen
 * 
 * Allows users to choose between Casual and Ranked matchmaking
 * - Casual: Play for fun, no ELO changes
 * - Ranked: Competitive play with ELO rating changes
 */
export default function MatchTypeSelectionScreen() {
  const navigation = useNavigation<MatchTypeSelectionNavigationProp>();
  const [selectedType, setSelectedType] = useState<'casual' | 'ranked'>('casual');

  const handleContinue = () => {
    // Navigate to Matchmaking screen with selected match type
    navigation.navigate('Matchmaking', { matchType: selectedType });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Back Button */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>

        {/* Title */}
        <Text style={styles.title}>{i18n.t('matchmaking.selectMatchType')}</Text>

        {/* Match Type Options */}
        <View style={styles.optionsContainer}>
          {/* Casual */}
          <TouchableOpacity
            style={[
              styles.optionCard,
              selectedType === 'casual' && styles.optionCardSelected
            ]}
            onPress={() => setSelectedType('casual')}
          >
            <View style={styles.optionHeader}>
              <Text style={styles.optionIcon}>😊</Text>
              <Text style={styles.optionTitle}>{i18n.t('matchmaking.casual')}</Text>
            </View>
            <Text style={styles.optionDescription}>
              {i18n.t('matchmaking.casualDesc')}
            </Text>
            {selectedType === 'casual' && (
              <View style={styles.checkmark}>
                <Text style={styles.checkmarkText}>✓</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Ranked */}
          <TouchableOpacity
            style={[
              styles.optionCard,
              selectedType === 'ranked' && styles.optionCardSelected
            ]}
            onPress={() => setSelectedType('ranked')}
          >
            <View style={styles.optionHeader}>
              <Text style={styles.optionIcon}>🏆</Text>
              <Text style={styles.optionTitle}>{i18n.t('matchmaking.ranked')}</Text>
            </View>
            <Text style={styles.optionDescription}>
              {i18n.t('matchmaking.rankedDesc')}
            </Text>
            {selectedType === 'ranked' && (
              <View style={styles.checkmark}>
                <Text style={styles.checkmarkText}>✓</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Continue Button */}
        <TouchableOpacity
          style={styles.continueButton}
          onPress={handleContinue}
        >
          <Text style={styles.continueButtonText}>
            {i18n.t('common.continue')} →
          </Text>
        </TouchableOpacity>
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
    padding: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    top: SPACING.md,
    left: SPACING.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  backButtonText: {
    color: COLORS.white,
    fontSize: 24,
    fontWeight: 'bold',
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.xl * 2,
    textAlign: 'center',
  },
  optionsContainer: {
    width: '100%',
    gap: SPACING.lg,
    marginBottom: SPACING.xl * 2,
  },
  optionCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    padding: SPACING.lg,
    position: 'relative',
  },
  optionCardSelected: {
    borderColor: COLORS.success,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  optionIcon: {
    fontSize: 32,
    marginRight: SPACING.sm,
  },
  optionTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  optionDescription: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.light,
    lineHeight: 22,
  },
  checkmark: {
    position: 'absolute',
    top: SPACING.md,
    right: SPACING.md,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  continueButton: {
    backgroundColor: COLORS.success,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl * 2,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  continueButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
  },
});
