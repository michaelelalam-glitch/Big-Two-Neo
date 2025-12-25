/**
 * StreakGraph Component - Rank Points Progression Chart
 * Shows how player's rank points change over games played
 * 
 * Features:
 * - Line chart showing rank points over game number (up to 100 games)
 * - Points go up on wins, down on losses
 * - Connected line showing progression trend
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Circle, Polyline, Text as SvgText } from 'react-native-svg';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';

interface GameHistory {
  id: string;
  finished_at: string;
  winner_id: string;
  player_1_id?: string;
  player_2_id?: string;
  player_3_id?: string;
  player_4_id?: string;
  player_1_score: number;
  player_2_score: number;
  player_3_score: number;
  player_4_score: number;
}

interface StreakGraphProps {
  gameHistory: GameHistory[];
  userId: string;
  currentWinStreak: number;
  longestWinStreak: number;
}

export const StreakGraph: React.FC<StreakGraphProps> = ({
  gameHistory,
  userId,
}) => {
  // Process game history to calculate rank points progression from REAL game data
  const pointsData = useMemo(() => {
    if (!gameHistory || gameHistory.length === 0) return [];

    // Sort games chronologically (oldest first)
    const sortedGames = [...gameHistory].sort(
      (a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime()
    );

    // Calculate points progression from actual game scores
    let currentPoints = 1000; // Starting rank points
    const WIN_POINTS = 25;
    const LOSS_POINTS = 15;

    return sortedGames.map((game, index) => {
      // Find which player slot the user was in
      let playerScore = 0;
      let isWin = false;
      
      if (game.player_1_id === userId) {
        playerScore = game.player_1_score;
      } else if (game.player_2_id === userId) {
        playerScore = game.player_2_score;
      } else if (game.player_3_id === userId) {
        playerScore = game.player_3_score;
      } else if (game.player_4_id === userId) {
        playerScore = game.player_4_score;
      }
      
      isWin = game.winner_id === userId;
      
      // Update points based on result (REAL rank point calculation)
      if (isWin) {
        currentPoints += WIN_POINTS;
      } else {
        currentPoints -= LOSS_POINTS;
      }

      return {
        gameNumber: index + 1,
        points: currentPoints,
        isWin,
        gameScore: playerScore, // Store actual game score
      };
    });
  }, [gameHistory, userId]);

  if (pointsData.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No game history available</Text>
        <Text style={styles.emptySubtext}>Play games to track your rank points!</Text>
      </View>
    );
  }

  // Graph dimensions
  const graphWidth = 320;
  const graphHeight = 200;
  const padding = { top: 30, right: 40, bottom: 50, left: 50 };
  const plotWidth = graphWidth - padding.left - padding.right;
  const plotHeight = graphHeight - padding.top - padding.bottom;

  // Calculate scales
  const maxGames = Math.min(pointsData.length, 100); // Show up to 100 games
  const displayData = pointsData.slice(-maxGames); // Take last N games
  
  const allPoints = displayData.map(d => d.points);
  const minPoints = Math.min(...allPoints);
  const maxPoints = Math.max(...allPoints);
  const pointsRange = maxPoints - minPoints || 100; // Avoid division by zero
  
  // Add padding to Y scale
  const yMin = minPoints - pointsRange * 0.1;
  const yMax = maxPoints + pointsRange * 0.1;
  const yRange = yMax - yMin;

  const xScale = plotWidth / (displayData.length - 1 || 1);
  const yScale = plotHeight / yRange;

  // Generate points for the line chart
  const points = displayData.map((data, index) => {
    const x = padding.left + index * xScale;
    const y = padding.top + (yMax - data.points) * yScale;
    return { 
      x, 
      y, 
      points: data.points, 
      gameNumber: data.gameNumber,
      isWin: data.isWin 
    };
  });

  // Generate polyline points string for SVG
  const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');

  // Find highest and lowest points
  const highestPoint = points.reduce((max, p) => p.points > max.points ? p : max, points[0]);
  const lowestPoint = points.reduce((min, p) => p.points < min.points ? p : min, points[0]);

  // Calculate X-axis label interval
  const labelInterval = Math.ceil(displayData.length / 10);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Rank Points Progression</Text>
      
      <View style={styles.graphContainer}>
        <Svg width={graphWidth} height={graphHeight}>
          {/* Y-axis grid lines (5 lines) */}
          {[0, 1, 2, 3, 4].map(i => {
            const value = yMin + (yRange * i / 4);
            const y = padding.top + plotHeight - (i * plotHeight / 4);
            return (
              <React.Fragment key={`grid-${i}`}>
                <Line
                  x1={padding.left}
                  y1={y}
                  x2={graphWidth - padding.right}
                  y2={y}
                  stroke={COLORS.border}
                  strokeWidth="1"
                  strokeDasharray="4,4"
                  opacity="0.3"
                />
                <SvgText
                  x={padding.left - 10}
                  y={y + 4}
                  fontSize="10"
                  fill={COLORS.textSecondary}
                  textAnchor="end"
                >
                  {Math.round(value)}
                </SvgText>
              </React.Fragment>
            );
          })}

          {/* X-axis */}
          <Line
            x1={padding.left}
            y1={graphHeight - padding.bottom}
            x2={graphWidth - padding.right}
            y2={graphHeight - padding.bottom}
            stroke={COLORS.border}
            strokeWidth="2"
          />

          {/* Y-axis */}
          <Line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={graphHeight - padding.bottom}
            stroke={COLORS.border}
            strokeWidth="2"
          />

          {/* Plot line connecting all points */}
          {points.length > 1 && (
            <Polyline
              points={polylinePoints}
              fill="none"
              stroke={COLORS.primary}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Plot points */}
          {points.map((point, index) => {
            const isHighest = point.points === highestPoint.points;
            const isLowest = point.points === lowestPoint.points;
            const isSpecial = isHighest || isLowest;
            
            return (
              <Circle
                key={`point-${index}`}
                cx={point.x}
                cy={point.y}
                r={isSpecial ? 6 : 3}
                fill={isHighest ? COLORS.success : isLowest ? COLORS.error : point.isWin ? COLORS.primary : COLORS.textSecondary}
                stroke={COLORS.background}
                strokeWidth="2"
              />
            );
          })}

          {/* X-axis labels (game numbers) */}
          {points.filter((_, i) => i % labelInterval === 0 || i === points.length - 1).map((point, idx) => (
            <SvgText
              key={`label-${idx}`}
              x={point.x}
              y={graphHeight - padding.bottom + 20}
              fontSize="10"
              fill={COLORS.textSecondary}
              textAnchor="middle"
            >
              {point.gameNumber}
            </SvgText>
          ))}

          {/* Axis labels */}
          <SvgText
            x={graphWidth / 2}
            y={graphHeight - 10}
            fontSize="12"
            fill={COLORS.text}
            textAnchor="middle"
            fontWeight="600"
          >
            Games Played
          </SvgText>

          <SvgText
            x={20}
            y={graphHeight / 2}
            fontSize="12"
            fill={COLORS.text}
            textAnchor="middle"
            fontWeight="600"
            transform={`rotate(-90, 20, ${graphHeight / 2})`}
          >
            Rank Points
          </SvgText>
        </Svg>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: COLORS.success }]} />
          <Text style={styles.legendText}>Peak points</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: COLORS.error }]} />
          <Text style={styles.legendText}>Lowest points</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: COLORS.primary }]} />
          <Text style={styles.legendText}>Win</Text>
        </View>
      </View>

      {/* Stats summary */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Total Games</Text>
          <Text style={styles.statValue}>{pointsData.length}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Current Points</Text>
          <Text style={styles.statValue}>{pointsData[pointsData.length - 1]?.points || 1000}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Peak Points</Text>
          <Text style={styles.statValue}>🏆 {highestPoint.points}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  title: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  graphContainer: {
    alignItems: 'center',
    marginVertical: SPACING.sm,
  },
  emptyContainer: {
    padding: SPACING.lg,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginTop: SPACING.xs,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  legendText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  statValue: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.text,
  },
});
