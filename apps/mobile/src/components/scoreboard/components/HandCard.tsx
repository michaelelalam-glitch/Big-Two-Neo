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

import React from 'react';
import { View, Text } from 'react-native';
import { HandCardProps } from '../../../types/scoreboard';
import { CardImage } from './CardImage';
import { usePlayHistoryModalStyles } from '../hooks/useResponsiveStyles';

export const HandCard: React.FC<HandCardProps> = ({
  hand,
  playerName,
  isLatest,
  isCurrentMatch,
}) => {
  // Use responsive styles
  const styles = usePlayHistoryModalStyles();
  
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

      {/* Cards */}
      <View style={styles.handCardsContainer}>
        {hand.cards.map((card, idx) => (
          <CardImage
            key={`${card.rank}-${card.suit}-${idx}`}
            rank={card.rank}
            suit={card.suit}
            width={35}
            height={51}
          />
        ))}
      </View>
    </View>
  );
};

export default HandCard;
