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
import { scoreboardStyles } from '../styles/scoreboard.styles';
import { HandCardProps } from '../../../types/scoreboard';
import { CardImage } from './CardImage';

export const HandCard: React.FC<HandCardProps> = ({
  hand,
  playerName,
  isLatest,
  isCurrentMatch,
}) => {
  // Format combo type for display
  const formatComboType = (type: string): string => {
    switch (type.toLowerCase()) {
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
      case 'full_house':
        return 'Full House';
      case 'fourofakind':
      case 'four_of_a_kind':
        return 'Four of a Kind';
      case 'straightflush':
      case 'straight_flush':
        return 'Straight Flush';
      default:
        return type;
    }
  };

  return (
    <View
      style={[
        scoreboardStyles.handCard,
        isLatest && isCurrentMatch && scoreboardStyles.handCardLatest,
      ]}
    >
      {/* Header: Player name + Combo type */}
      <View style={scoreboardStyles.handCardHeader}>
        <Text style={scoreboardStyles.handPlayerName}>{playerName}</Text>
        <Text style={scoreboardStyles.handComboType}>
          {formatComboType(hand.type)} ({hand.count})
        </Text>
      </View>

      {/* Cards */}
      <View style={scoreboardStyles.handCardsContainer}>
        {hand.cards.map((card, index) => (
          <CardImage
            key={`${card.id || `${card.rank}-${card.suit}-${index}`}`}
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
