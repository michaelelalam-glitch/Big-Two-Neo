import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING } from '../constants';
import { i18n } from '../i18n';

type HowToPlayNavigationProp = StackNavigationProp<RootStackParamList, 'HowToPlay'>;

export default function HowToPlayScreen() {
    // Helper to get correct translation keys for each language
    const lang = i18n.getLanguage();
    const t = (key: string) => i18n.t(key);

    // Key mapping for each language
    const keys = lang === 'en' ? {
      note: 'howToPlay.cardNote',
      combinationsTitle: 'howToPlay.validCombinationsTitle',
      single: 'howToPlay.single',
      pair: 'howToPlay.pair',
      triple: 'howToPlay.triple',
      straight: 'howToPlay.straight',
      flush: 'howToPlay.flush',
      fullHouse: 'howToPlay.fullHouse',
      fourOfAKind: 'howToPlay.fourOfAKind',
      straightFlush: 'howToPlay.straightFlush',
      scoring1: 'howToPlay.scoring1to4',
      scoring2: 'howToPlay.scoring5to9',
      scoring3: 'howToPlay.scoring10to13',
    } : {
      note: 'howToPlay.noteText',
      combinationsTitle: 'howToPlay.combinationsTitle',
      single: 'howToPlay.singleLabel',
      singleText: 'howToPlay.singleText',
      pair: 'howToPlay.pairLabel',
      pairText: 'howToPlay.pairText',
      triple: 'howToPlay.tripleLabel',
      tripleText: 'howToPlay.tripleText',
      fiveCardCombos: 'howToPlay.fiveCardCombosLabel',
      straight: 'howToPlay.straightLabel',
      straightText: 'howToPlay.straightText',
      flush: 'howToPlay.flushLabel',
      flushText: 'howToPlay.flushText',
      fullHouse: 'howToPlay.fullHouseLabel',
      fullHouseText: 'howToPlay.fullHouseText',
      fourOfAKind: 'howToPlay.fourOfAKindLabel',
      fourOfAKindText: 'howToPlay.fourOfAKindText',
      straightFlush: 'howToPlay.straightFlushLabel',
      straightFlushText: 'howToPlay.straightFlushText',
      scoring1: 'howToPlay.scoring1to7',
      scoring2: 'howToPlay.scoring8to10',
      scoring3: 'howToPlay.scoring11to12',
    };
  const navigation = useNavigation<HowToPlayNavigationProp>();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Back Button removed as per request */}

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          isLandscape && styles.scrollContentLandscape
        ]}
        showsVerticalScrollIndicator={!isLandscape}
      >
        {/* Logo */}
        <View style={[styles.logoContainer, isLandscape && styles.logoContainerLandscape]}>
          <Text style={styles.logoEmoji}>🎴</Text>
        </View>

        {/* Title */}
        <Text style={styles.title}>{i18n.t('howToPlay.title')}</Text>

        {/* Objective */}
        <View style={styles.section}>
          <Text style={styles.heading}>🎯 {i18n.t('howToPlay.objectiveTitle')}</Text>
          <Text style={styles.body}>{i18n.t('howToPlay.objectiveText')}</Text>
        </View>

        {/* Card Rankings */}
        <View style={styles.section}>
          <Text style={styles.subheading}>{i18n.t('howToPlay.rankOrderLabel')}</Text>
          <Text style={styles.body}>{i18n.t('howToPlay.rankOrder')}</Text>
          <Text style={styles.subheading}>{i18n.t('howToPlay.suitOrderLabel')}</Text>
          <Text style={styles.body}>{i18n.t('howToPlay.suitOrder')}</Text>
        </View>

        {/* Orange Note */}
        <View style={styles.orangeBubble}>
          <Text style={styles.noteText}>{t(keys.note)}</Text>
        </View>

        {/* Valid Combinations */}
        <View style={styles.section}>
          <Text style={styles.heading}>🎮 {t(keys.combinationsTitle)}</Text>
          {lang === 'en' ? (
            <>
              <Text style={styles.body}>{t(keys.single)}</Text>
              <Text style={styles.body}>{t(keys.pair)}</Text>
              <Text style={styles.body}>{t(keys.triple)}</Text>
              <Text style={styles.body}>{t(keys.straight)}</Text>
              <Text style={styles.body}>{t(keys.flush)}</Text>
              <Text style={styles.body}>{t(keys.fullHouse)}</Text>
              <Text style={styles.body}>{t(keys.fourOfAKind)}</Text>
              <Text style={styles.body}>{t(keys.straightFlush)}</Text>
            </>
          ) : (
            <>
              <Text style={styles.body}><Text style={{fontWeight:'bold'}}>{t(keys.single) || ''}</Text> {t(keys.singleText || '') || ''}</Text>
              <Text style={styles.body}><Text style={{fontWeight:'bold'}}>{t(keys.pair) || ''}</Text> {t(keys.pairText || '') || ''}</Text>
              <Text style={styles.body}><Text style={{fontWeight:'bold'}}>{t(keys.triple) || ''}</Text> {t(keys.tripleText || '') || ''}</Text>
              <Text style={styles.body}><Text style={{fontWeight:'bold'}}>{t(keys.fiveCardCombos || '') || ''}</Text></Text>
              <Text style={styles.body}><Text style={{fontWeight:'bold'}}>{t(keys.straight) || ''}</Text> {t(keys.straightText || '') || ''}</Text>
              <Text style={styles.body}><Text style={{fontWeight:'bold'}}>{t(keys.flush) || ''}</Text> {t(keys.flushText || '') || ''}</Text>
              <Text style={styles.body}><Text style={{fontWeight:'bold'}}>{t(keys.fullHouse) || ''}</Text> {t(keys.fullHouseText || '') || ''}</Text>
              <Text style={styles.body}><Text style={{fontWeight:'bold'}}>{t(keys.fourOfAKind) || ''}</Text> {t(keys.fourOfAKindText || '') || ''}</Text>
              <Text style={styles.body}><Text style={{fontWeight:'bold'}}>{t(keys.straightFlush) || ''}</Text> {t(keys.straightFlushText || '') || ''}</Text>
            </>
          )}
        </View>

        {/* Gameplay */}
        <View style={styles.section}>
          <Text style={styles.heading}>⚡ {i18n.t('howToPlay.gameplayTitle')}</Text>
          {lang === 'en' ? (
            <>
              <Text style={styles.body}>{i18n.t('howToPlay.startingGame')}</Text>
              <Text style={styles.body}>{i18n.t('howToPlay.playingCards')}</Text>
              <Text style={styles.body}>{i18n.t('howToPlay.passing')}</Text>
              <Text style={styles.body}>{i18n.t('howToPlay.leading')}</Text>
              <Text style={styles.body}>{i18n.t('howToPlay.winning')}</Text>
            </>
          ) : (
            <>
              <Text style={styles.body}>{i18n.t('howToPlay.gameplayPoint1')}</Text>
              <Text style={styles.body}>{i18n.t('howToPlay.gameplayPoint2')}</Text>
              <Text style={styles.body}>{i18n.t('howToPlay.gameplayPoint3')}</Text>
              <Text style={styles.body}>{i18n.t('howToPlay.gameplayPoint4')}</Text>
              <Text style={styles.body}>{i18n.t('howToPlay.gameplayPoint5')}</Text>
            </>
          )}
        </View>

        {/* Special Rules */}
        <View style={styles.section}>
          <Text style={styles.heading}>💡 {i18n.t('howToPlay.specialRulesTitle')}</Text>
          {lang === 'en' ? (
            <>
              <Text style={styles.body}>{i18n.t('howToPlay.autoPassTimer')}</Text>
              <Text style={styles.body}>{i18n.t('howToPlay.oneCardLeft')}</Text>
              <Text style={styles.body}>{i18n.t('howToPlay.fiveCardCombos')}</Text>
            </>
          ) : (
            <>
              <Text style={styles.body}>{i18n.t('howToPlay.specialRule1')}</Text>
              <Text style={styles.body}>{i18n.t('howToPlay.specialRule2')}</Text>
              <Text style={styles.body}>{i18n.t('howToPlay.specialRule3')}</Text>
            </>
          )}
        </View>

        {/* Scoring */}
        <View style={styles.section}>
          <Text style={styles.heading}>🏆 {i18n.t('howToPlay.scoringTitle')}</Text>
          <Text style={styles.body}>{i18n.t('howToPlay.scoringIntro')}</Text>
          <Text style={styles.body}>{t(keys.scoring1)}</Text>
          <Text style={styles.body}>{t(keys.scoring2)}</Text>
          <Text style={styles.body}>{t(keys.scoring3)}</Text>
        </View>

        {/* Red Warning */}
        <View style={styles.redBubble}>
          <Text style={styles.warningText}>{i18n.t('howToPlay.scoringWarning')}</Text>
        </View>

        {/* ELO Rating System */}
        <View style={styles.section}>
          <Text style={styles.heading}>{i18n.t('howToPlay.eloSystemTitle')}</Text>
          <Text style={styles.body}>{i18n.t('howToPlay.eloSystemDesc')}</Text>
          <Text style={styles.body}>{i18n.t('howToPlay.eloFormula')}</Text>
          <Text style={styles.subheading}>{i18n.t('howToPlay.rankTiersTitle')}</Text>
          <Text style={styles.body}>🥉 Bronze (0-999)</Text>
          <Text style={styles.body}>🥈 Silver (1000-1399)</Text>
          <Text style={styles.body}>🥇 Gold (1400-1799)</Text>
          <Text style={styles.body}>💎 Diamond (1800-2199)</Text>
          <Text style={styles.body}>👑 Master (2200+)</Text>
        </View>

        {/* Reconnection & Disconnection */}
        <View style={styles.section}>
          <Text style={styles.heading}>{i18n.t('howToPlay.reconnectionTitle')}</Text>
          <Text style={styles.body}>{i18n.t('howToPlay.reconnectionDesc')}</Text>
          <Text style={styles.body}>{i18n.t('howToPlay.disconnectGrace')}</Text>
          <Text style={styles.body}>{i18n.t('howToPlay.botReplacement')}</Text>
          <Text style={styles.body}>{i18n.t('howToPlay.spectatorMode')}</Text>
        </View>

        {/* Let's Play Button */}
        <TouchableOpacity
          style={styles.playButton}
          onPress={() => navigation.navigate('Home')}
        >
          <Text style={styles.playButtonText}>{i18n.t('howToPlay.letsPlay')}</Text>
        </TouchableOpacity>

        <View style={{ height: SPACING.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  backButton: {
    position: 'absolute',
    top: SPACING.md,
    left: SPACING.md,
    zIndex: 100,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: COLORS.white,
    fontSize: 24,
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingTop: 60, // Space for back button
    paddingBottom: SPACING.xl * 2,
  },
  scrollContentLandscape: {
    paddingHorizontal: SPACING.xl * 3,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  logoContainerLandscape: {
    marginBottom: SPACING.sm,
  },
  logoEmoji: {
    fontSize: 64,
  },
  title: {
    fontSize: 32, // 32pt as per Figma
    fontFamily: 'Inter',
    fontWeight: 'bold',
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  heading: {
    fontSize: 24, // 24pt Inter as per Figma
    fontFamily: 'Inter',
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: SPACING.sm,
  },
  subheading: {
    fontSize: 20, // 20pt Inter as per Figma
    fontFamily: 'Inter',
    fontWeight: '600',
    color: COLORS.secondary,
    marginBottom: SPACING.xs,
    marginTop: SPACING.xs,
  },
  body: {
    fontSize: 16, // 16pt Times New Roman as per Figma
    fontFamily: 'Times New Roman',
    color: COLORS.white,
    lineHeight: 24,
    marginBottom: SPACING.sm,
  },
  orangeBubble: {
    backgroundColor: '#FF9500',
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    marginHorizontal: SPACING.sm,
  },
  noteText: {
    fontSize: 16,
    fontFamily: 'Times New Roman',
    color: '#000000',
    textAlign: 'center',
    fontWeight: '600',
  },
  redBubble: {
    backgroundColor: '#FF3B30',
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.xl,
    marginHorizontal: SPACING.sm,
  },
  warningText: {
    fontSize: 16,
    fontFamily: 'Times New Roman',
    color: '#FFFFFF',
    textAlign: 'center',
    fontWeight: '600',
  },
  playButton: {
    backgroundColor: '#10B981',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: SPACING.lg,
    marginHorizontal: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  playButtonText: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: 'Inter',
  },
});
