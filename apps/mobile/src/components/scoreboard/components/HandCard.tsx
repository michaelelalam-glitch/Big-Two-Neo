/**
 * HandCard Component
 * 
 * Displays a single hand (card play) in the play history
 * Features:
 * - Player name + combo type display
 * - Card images in a row (wrapping if needed)
 * - Latest hand highlighted with blue background
 * - Card sorting for straights/flushes
 * 
 * Created as part of Task #349: HandCard component
 * Date: December 12, 2025
 */

import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { HandCardProps } from '../../../types/scoreboard';
import { CardImage } from './CardImage';
import { usePlayHistoryModalStyles } from '../hooks/useResponsiveStyles';
import { sortCardsForDisplay } from '../../../utils/cardSorting';

export const HandCard: React.FC<HandCardProps> = ({
  hand,
  playerName,
  isLatest,
  isCurrentMatch,
}) => {
  // Use responsive styles
  const styles = usePlayHistoryModalStyles();
  
  // Sort cards for display (highest first - Task #313)
  const displayCards = useMemo(() => {
    if (!hand.cards || hand.cards.length === 0) return [];
    return sortCardsForDisplay(hand.cards, hand.type);
  }, [hand.cards, hand.type]);
  
  // Format combo type for display
  const formatComboType = (type: string): string => {
    const normalized = type.replace(/[_\s]/g, '').toLowerCase();
    switch (normalized) {
      case 'single':
        return 'Single';
      case 'pair':
        return 'Pair';
      case 'triple':
        return 'Triple';
      case 'straight':
        return 'Straight';
      case 'flush':
        return 'Flush';
      case 'fullhouse':
        return 'Full House';
      case 'fourofakind':
        return 'Four of a Kind';
      case 'straightflush':
        return 'Straight Flush';
      default:
        return type;
    }
  };

  return (
    <View
      style={[
        styles.handCard,
        isLatest && isCurrentMatch && styles.handCardLatest,
      ]}
    >
      {/* Header: Player name + Combo type */}
      <View style={styles.handCardHeader}>
        <Text style={styles.handPlayerName}>{playerName}</Text>
        <Text style={styles.handComboType}>
          {formatComboType(hand.type)} ({hand.count})
        </Text>
      </View>

      {/* Cards - Task #313: Display sorted with highest card first */}
      <View style={styles.handCardsContainer}>
        {displayCards.length > 0 ? (
          displayCards.map((card, idx) => (
            <CardImage
              key={`${card.rank}-${card.suit}-${idx}`}
              rank={card.rank}
              suit={card.suit}
              width={40}
              height={58}
            />
          ))
        ) : (
          <Text style={styles.handComboType}>No cards recorded</Text>
        )}
      </View>
    </View>
  );
};

export default HandCard;
