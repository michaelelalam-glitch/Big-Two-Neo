// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ==================== TYPES ====================

interface Card {
  id: string;
  suit: 'D' | 'C' | 'H' | 'S';
  rank: '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2';
}

type ComboType = 'Single' | 'Pair' | 'Triple' | 'Straight' | 'Flush' | 'Full House' | 'Four of a Kind' | 'Straight Flush';

interface LastPlay {
  cards: Card[];
  combo_type: ComboType;
  player_index: number;
}

// ==================== CONSTANTS ====================

const RANK_VALUE: Record<string, number> = {
  '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8,
  'J': 9, 'Q': 10, 'K': 11, 'A': 12, '2': 13,
};

const SUIT_VALUE: Record<string, number> = {
  'D': 1, 'C': 2, 'H': 3, 'S': 4,
};

const COMBO_STRENGTH: Record<ComboType, number> = {
  'Single': 1,
  'Pair': 2,
  'Triple': 3,
  'Straight': 4,
  'Flush': 5,
  'Full House': 6,
  'Four of a Kind': 7,
  'Straight Flush': 8,
};

const VALID_STRAIGHT_SEQUENCES: string[][] = [
  ['3', '4', '5', '6', '7'],
  ['4', '5', '6', '7', '8'],
  ['5', '6', '7', '8', '9'],
  ['6', '7', '8', '9', '10'],
  ['7', '8', '9', '10', 'J'],
  ['8', '9', '10', 'J', 'Q'],
  ['9', '10', 'J', 'Q', 'K'],
  ['10', 'J', 'Q', 'K', 'A'],
  ['J', 'Q', 'K', 'A', '2'],
];

// ==================== GAME LOGIC ====================

function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const rankDiff = RANK_VALUE[a.rank] - RANK_VALUE[b.rank];
    if (rankDiff !== 0) return rankDiff;
    return SUIT_VALUE[a.suit] - SUIT_VALUE[b.suit];
  });
}

function sameRank(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  return cards.every(c => c.rank === cards[0].rank);
}

function countByRank(cards: Card[]): Record<string, number> {
  return cards.reduce((acc, card) => {
    acc[card.rank] = (acc[card.rank] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

function findStraightSequenceIndex(ranks: string[]): number {
  const rankSet = new Set(ranks);
  for (let i = 0; i < VALID_STRAIGHT_SEQUENCES.length; i++) {
    const seq = VALID_STRAIGHT_SEQUENCES[i];
    if (seq.every(r => rankSet.has(r))) {
      return i;
    }
  }
  return -1;
}

function isStraight(cards: Card[]): { valid: boolean; sequence: string } {
  if (cards.length !== 5) return { valid: false, sequence: '' };
  
  const ranks = cards.map(c => c.rank);
  const seqIndex = findStraightSequenceIndex(ranks);
  
  if (seqIndex !== -1) {
    return { valid: true, sequence: VALID_STRAIGHT_SEQUENCES[seqIndex].join('') };
  }
  
  return { valid: false, sequence: '' };
}

function classifyFive(cards: Card[]): ComboType | 'unknown' {
  if (cards.length !== 5) return 'unknown';
  
  const sorted = sortHand(cards);
  const counts = countByRank(sorted);
  const countValues = Object.values(counts).sort((a, b) => b - a);
  
  const isFlush = sorted.every(c => c.suit === sorted[0].suit);
  const straightInfo = isStraight(sorted);
  
  if (straightInfo.valid && isFlush) return 'Straight Flush';
  if (countValues[0] === 4) return 'Four of a Kind';
  if (countValues[0] === 3 && countValues[1] === 2) return 'Full House';
  if (isFlush) return 'Flush';
  if (straightInfo.valid) return 'Straight';
  
  return 'unknown';
}

function classifyCards(cards: Card[]): ComboType | 'unknown' {
  if (!cards || cards.length === 0) return 'unknown';
  
  const n = cards.length;
  const sorted = sortHand(cards);
  
  if (n === 1) return 'Single';
  if (n === 2 && sameRank(sorted)) return 'Pair';
  if (n === 3 && sameRank(sorted)) return 'Triple';
  if (n === 5) return classifyFive(sorted);
  
  return 'unknown';
}

function getCardValue(card: Card): number {
  return RANK_VALUE[card.rank] * 10 + SUIT_VALUE[card.suit];
}

function getTripleRank(cards: Card[]): string {
  const counts = countByRank(cards);
  for (const rank in counts) {
    if (counts[rank] === 3) return rank;
  }
  throw new Error('No triple found in full house');
}

function getQuadRank(cards: Card[]): string {
  const counts = countByRank(cards);
  for (const rank in counts) {
    if (counts[rank] === 4) return rank;
  }
  throw new Error('No quad found in four of a kind');
}

function canBeatPlay(newCards: Card[], lastPlay: LastPlay | null): boolean {
  if (!lastPlay) return true;
  if (newCards.length !== lastPlay.cards.length) return false;
  
  const newCombo = classifyCards(newCards);
  if (newCombo === 'unknown') return false;
  
  const newStrength = COMBO_STRENGTH[newCombo] || 0;
  const lastStrength = COMBO_STRENGTH[lastPlay.combo_type] || 0;
  
  if (newCombo !== lastPlay.combo_type) {
    return newStrength > lastStrength;
  }
  
  const newSorted = sortHand(newCards);
  const lastSorted = sortHand(lastPlay.cards);
  
  if (newCombo === 'Full House') {
    const newTripleRank = getTripleRank(newSorted);
    const lastTripleRank = getTripleRank(lastSorted);
    return RANK_VALUE[newTripleRank] > RANK_VALUE[lastTripleRank];
  }
  
  if (newCombo === 'Four of a Kind') {
    const newQuadRank = getQuadRank(newSorted);
    const lastQuadRank = getQuadRank(lastSorted);
    return RANK_VALUE[newQuadRank] > RANK_VALUE[lastQuadRank];
  }
  
  const newHighest = newSorted[newSorted.length - 1];
  const lastHighest = lastSorted[lastSorted.length - 1];
  
  return getCardValue(newHighest) > getCardValue(lastHighest);
}

// ==================== HIGHEST PLAY DETECTION ====================

function generateFullDeck(): Card[] {
  const deck: Card[] = [];
  const suits: ('D' | 'C' | 'H' | 'S')[] = ['D', 'C', 'H', 'S'];
  const ranks: Card['rank'][] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ id: `${rank}${suit}`, rank, suit });
    }
  }
  return deck;
}

const FULL_DECK = generateFullDeck();

function getRemainingCards(playedCards: Card[]): Card[] {
  return FULL_DECK.filter(
    (card) => !playedCards.some((played) => played.id === card.id)
  );
}

function cardsEqual(a: Card, b: Card): boolean {
  return a.id === b.id;
}

function isHighestRemainingSingle(card: Card, playedCards: Card[]): boolean {
  const remaining = getRemainingCards(playedCards);
  if (remaining.length === 0) return false;
  
  const sorted = sortHand(remaining);
  const highest = sorted[sorted.length - 1];
  
  return cardsEqual(card, highest);
}

function generateAllPairs(remaining: Card[]): Card[][] {
  const pairs: Card[][] = [];
  const rankGroups: { [rank: string]: Card[] } = {};
  
  for (const card of remaining) {
    if (!rankGroups[card.rank]) {
      rankGroups[card.rank] = [];
    }
    rankGroups[card.rank].push(card);
  }
  
  for (const rank in rankGroups) {
    const group = rankGroups[rank];
    if (group.length >= 2) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          pairs.push([group[i], group[j]]);
        }
      }
    }
  }
  
  return pairs;
}

function isHighestRemainingPair(pair: Card[], playedCards: Card[]): boolean {
  if (pair.length !== 2 || pair[0].rank !== pair[1].rank) {
    return false;
  }
  
  const remaining = getRemainingCards(playedCards);
  const notInCurrentPair = remaining.filter(
    c => !pair.some(p => p.id === c.id)
  );
  
  const otherPairs = generateAllPairs(notInCurrentPair);
  
  if (otherPairs.length === 0) {
    return true;
  }
  
  const sortedPairs = otherPairs.map(p => sortHand(p)).sort((a, b) => {
    const rankDiff = RANK_VALUE[a[0].rank] - RANK_VALUE[b[0].rank];
    if (rankDiff !== 0) return rankDiff;
    return SUIT_VALUE[a[1].suit] - SUIT_VALUE[b[1].suit];
  });
  
  const highestOtherPair = sortedPairs[sortedPairs.length - 1];
  const sortedCurrentPair = sortHand(pair);
  
  const rankDiff = RANK_VALUE[sortedCurrentPair[0].rank] - RANK_VALUE[highestOtherPair[0].rank];
  if (rankDiff > 0) return true;
  if (rankDiff < 0) return false;
  
  const suitDiff = SUIT_VALUE[sortedCurrentPair[1].suit] - SUIT_VALUE[highestOtherPair[1].suit];
  return suitDiff >= 0;
}

function generateAllTriples(remaining: Card[]): Card[][] {
  const triples: Card[][] = [];
  const rankGroups: { [rank: string]: Card[] } = {};
  
  for (const card of remaining) {
    if (!rankGroups[card.rank]) {
      rankGroups[card.rank] = [];
    }
    rankGroups[card.rank].push(card);
  }
  
  for (const rank in rankGroups) {
    const group = rankGroups[rank];
    if (group.length >= 3) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          for (let k = j + 1; k < group.length; k++) {
            triples.push([group[i], group[j], group[k]]);
          }
        }
      }
    }
  }
  
  return triples;
}

function isHighestRemainingTriple(triple: Card[], playedCards: Card[]): boolean {
  if (triple.length !== 3 || !sameRank(triple)) {
    return false;
  }
  
  const remaining = getRemainingCards(playedCards);
  const notInCurrentTriple = remaining.filter(
    c => !triple.some(t => t.id === c.id)
  );
  
  const otherTriples = generateAllTriples(notInCurrentTriple);
  
  if (otherTriples.length === 0) {
    return true;
  }
  
  const sortedTriples = otherTriples.map(t => sortHand(t)).sort((a, b) => {
    const rankDiff = RANK_VALUE[a[0].rank] - RANK_VALUE[b[0].rank];
    if (rankDiff !== 0) return rankDiff;
    return SUIT_VALUE[a[2].suit] - SUIT_VALUE[b[2].suit];
  });
  
  const highestOtherTriple = sortedTriples[sortedTriples.length - 1];
  const sortedCurrentTriple = sortHand(triple);
  
  const rankDiff = RANK_VALUE[sortedCurrentTriple[0].rank] - RANK_VALUE[highestOtherTriple[0].rank];
  if (rankDiff > 0) return true;
  if (rankDiff < 0) return false;
  
  const suitDiff = SUIT_VALUE[sortedCurrentTriple[2].suit] - SUIT_VALUE[highestOtherTriple[2].suit];
  return suitDiff >= 0;
}

function isHighestRemainingFiveCardCombo(cards: Card[], comboType: ComboType | 'unknown', playedCards: Card[]): boolean {
  if (cards.length !== 5 || comboType === 'unknown') return false;
  
  const comboStrength = COMBO_STRENGTH[comboType as ComboType];
  const remaining = getRemainingCards(playedCards);
  const notInCurrent = remaining.filter(c => !cards.some(p => p.id === c.id));
  
  // Check if any stronger combo type is possible
  for (const [type, strength] of Object.entries(COMBO_STRENGTH)) {
    if (strength > comboStrength) {
      if (canFormCombo(notInCurrent, type as ComboType)) {
        return false;
      }
    }
  }
  
  // Check if same combo type but stronger exists
  const sameTypeCombos = generateCombosOfType(notInCurrent, comboType as ComboType);
  if (sameTypeCombos.length === 0) {
    return true;
  }
  
  const sorted = sortHand(cards);
  const highest = sorted[sorted.length - 1];
  
  for (const combo of sameTypeCombos) {
    const comboSorted = sortHand(combo);
    const comboHighest = comboSorted[comboSorted.length - 1];
    
    if (getCardValue(comboHighest) > getCardValue(highest)) {
      return false;
    }
  }
  
  return true;
}

function canFormCombo(cards: Card[], comboType: ComboType): boolean {
  if (comboType === 'Straight Flush') {
    return canFormStraightFlush(cards);
  }
  if (comboType === 'Four of a Kind') {
    return canFormFourOfAKind(cards);
  }
  if (comboType === 'Full House') {
    return canFormFullHouse(cards);
  }
  if (comboType === 'Flush') {
    return canFormFlush(cards);
  }
  if (comboType === 'Straight') {
    return canFormStraight(cards);
  }
  return false;
}

function canFormStraightFlush(cards: Card[]): boolean {
  const bySuit: { [suit: string]: Card[] } = {};
  for (const card of cards) {
    if (!bySuit[card.suit]) bySuit[card.suit] = [];
    bySuit[card.suit].push(card);
  }
  
  for (const suit in bySuit) {
    if (bySuit[suit].length >= 5) {
      const straightInfo = isStraight(bySuit[suit].slice(0, 5));
      if (straightInfo.valid) return true;
    }
  }
  return false;
}

function canFormFourOfAKind(cards: Card[]): boolean {
  const counts = countByRank(cards);
  return Object.values(counts).some(count => count >= 4);
}

function canFormFullHouse(cards: Card[]): boolean {
  const counts = countByRank(cards);
  const values = Object.values(counts).sort((a, b) => b - a);
  return values[0] >= 3 && values[1] >= 2;
}

function canFormFlush(cards: Card[]): boolean {
  const bySuit: { [suit: string]: number } = {};
  for (const card of cards) {
    bySuit[card.suit] = (bySuit[card.suit] || 0) + 1;
  }
  return Object.values(bySuit).some(count => count >= 5);
}

function canFormStraight(cards: Card[]): boolean {
  const ranks = [...new Set(cards.map(c => c.rank))];
  for (const seq of VALID_STRAIGHT_SEQUENCES) {
    if (seq.every(r => ranks.includes(r))) {
      return true;
    }
  }
  return false;
}

function generateCombosOfType(cards: Card[], comboType: ComboType): Card[][] {
  // Simplified implementation - return empty for now
  // Full implementation would generate all possible combos of that type
  return [];
}

function isHighestPossiblePlay(cards: Card[], playedCards: Card[]): boolean {
  if (!cards || cards.length === 0) return false;

  const sorted = sortHand(cards);
  const type = classifyCards(cards);

  switch (cards.length) {
    case 1:
      return isHighestRemainingSingle(sorted[0], playedCards);
    case 2:
      return isHighestRemainingPair(sorted, playedCards);
    case 3:
      return isHighestRemainingTriple(sorted, playedCards);
    case 5:
      return isHighestRemainingFiveCardCombo(sorted, type, playedCards);
    default:
      return false;
  }
}

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { room_code, player_id, cards } = await req.json();

    if (!room_code || !player_id || !cards || cards.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Get room ID
    const { data: room, error: roomError } = await supabaseClient
      .from('rooms')
      .select('id')
      .eq('code', room_code)
      .single();

    if (roomError || !room) {
      return new Response(
        JSON.stringify({ success: false, error: 'Room not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Get game state WITH ROW LOCK
    const { data: gameState, error: gameStateError } = await supabaseClient
      .from('game_state')
      .select('*')
      .eq('room_id', room.id)
      .single();

    if (gameStateError || !gameState) {
      return new Response(
        JSON.stringify({ success: false, error: 'Game state not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Get player info
    const { data: player, error: playerError } = await supabaseClient
      .from('room_players')
      .select('*')
      .eq('id', player_id)
      .eq('room_id', room.id)
      .single();

    if (playerError || !player) {
      return new Response(
        JSON.stringify({ success: false, error: 'Player not found in room' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Verify it's this player's turn
    if (gameState.current_turn !== player.player_index) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Not your turn',
          current_turn: gameState.current_turn,
          your_index: player.player_index,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. ✅ Validate 3♦ requirement (ONLY first play of FIRST MATCH)
    const match_number = gameState.match_number || 1;
    const played_cards = gameState.played_cards || [];
    const is_first_play = played_cards.length === 0;

    if (is_first_play && match_number === 1) {
      const has_three_diamond = cards.some((c: Card) => c.id === '3D');
      if (!has_three_diamond) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'First play of first match must include 3♦ (three of diamonds)',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 6. ✅ Classify combo and validate
    const comboType = classifyCards(cards);
    if (comboType === 'unknown') {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid card combination' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. ✅ Check if play beats last play
    const lastPlay = gameState.last_play as LastPlay | null;
    if (!canBeatPlay(cards, lastPlay)) {
      const lastCombo = lastPlay?.combo_type || 'None';
      return new Response(
        JSON.stringify({
          success: false,
          error: `Cannot beat ${lastCombo} with ${comboType}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 8. ✅ Verify player has all the cards
    const currentHands = gameState.hands || {};
    const playerHand = currentHands[player.player_index] || [];
    
    for (const card of cards) {
      const hasCard = playerHand.some((c: Card) => c.id === card.id);
      if (!hasCard) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Card not in hand: ${card.id}`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 9. ✅ ONE CARD LEFT RULE: Check if next player has 1 card
    const nextPlayerIndex = (player.player_index + 1) % 4;
    const nextPlayerHand = currentHands[nextPlayerIndex] || [];
    const nextPlayerHasOneCard = nextPlayerHand.length === 1;

    // CRITICAL FIX: Only enforce One Card Left when there's a last play to beat
    // Don't enforce when leading (no lastPlay)
    if (nextPlayerHasOneCard && lastPlay && cards.length === 1) {
      // Next player has 1 card and current player is playing a single
      // Must verify this is the highest beating single they have
      const sortedPlayerHand = sortHand(playerHand);
      
      // Only get singles that CAN beat the last play
      const allBeatingSingles = sortedPlayerHand.filter(c => {
        try {
          return canBeatPlay([c], lastPlay);
        } catch (e) {
          return false; // If can't beat, exclude it
        }
      });
      
      // Only enforce if there ARE beating singles available
      if (allBeatingSingles.length > 0) {
        const highestBeatingSingle = allBeatingSingles[allBeatingSingles.length - 1];
        const playedCard = cards[0];
        
        // Check if they're playing the highest beating single
        if (playedCard.id !== highestBeatingSingle.id) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'One Card Left Rule: You must play your highest single that beats the last play',
              required_card: highestBeatingSingle,
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // 10. ✅ Remove cards from player's hand
    const cardIdsToRemove = new Set(cards.map((c: Card) => c.id));
    const updatedHand = playerHand.filter((c: Card) => !cardIdsToRemove.has(c.id));
    
    const updatedHands = {
      ...currentHands,
      [player.player_index]: updatedHand,
    };

    // 11. Check if match ended (player played last card)
    const matchEnded = updatedHand.length === 0;
    
    // 12. Calculate match scores if match ended
    let matchScores: any[] | null = null;
    let gameOver = false;
    let finalWinnerIndex: number | null = null;
    
    if (matchEnded) {
      console.log('🏁 Match ended! Calculating scores...');
      
      // Get all room players with current scores
      const { data: roomPlayersData, error: playersError } = await supabaseClient
        .from('room_players')
        .select('*')
        .eq('room_id', room.id)
        .order('player_index', { ascending: true });

      if (playersError || !roomPlayersData) {
        console.error('Failed to get room players for scoring:', playersError);
      } else {
        // Calculate scores for each player
        matchScores = roomPlayersData.map((rp) => {
          const hand = updatedHands[rp.player_index];
          const cardsRemaining = hand ? hand.length : 0;
          const currentScore = rp.score || 0;
          
          // Scoring logic
          let pointsPerCard: number;
          if (cardsRemaining >= 1 && cardsRemaining <= 4) {
            pointsPerCard = 1;
          } else if (cardsRemaining >= 5 && cardsRemaining <= 9) {
            pointsPerCard = 2;
          } else if (cardsRemaining >= 10 && cardsRemaining <= 13) {
            pointsPerCard = 3;
          } else {
            pointsPerCard = 0; // Winner
          }
          
          const matchScore = cardsRemaining * pointsPerCard;
          const cumulativeScore = currentScore + matchScore;
          
          return {
            player_index: rp.player_index,
            user_id: rp.user_id,
            cardsRemaining,
            pointsPerCard,
            matchScore,
            cumulativeScore,
          };
        });

        console.log('📊 Match scores calculated:', matchScores);

        // Update room_players with new cumulative scores
        for (const score of matchScores) {
          await supabaseClient
            .from('room_players')
            .update({ score: score.cumulativeScore })
            .eq('room_id', room.id)
            .eq('player_index', score.player_index);
        }

        // Check if game should end (someone >= 101 points)
        gameOver = matchScores.some(s => s.cumulativeScore >= 101);
        
        if (gameOver) {
          // Find final winner (lowest score)
          let lowestScore = Infinity;
          let winnerIndex = matchScores[0].player_index;
          
          for (const score of matchScores) {
            if (score.cumulativeScore < lowestScore) {
              lowestScore = score.cumulativeScore;
              winnerIndex = score.player_index;
            }
          }
          
          finalWinnerIndex = winnerIndex;
          console.log('🎉 GAME OVER! Final winner:', finalWinnerIndex, 'Scores:', matchScores);
        }
      }
    }

    // 13. Calculate next turn
    const nextTurn = (player.player_index + 1) % 4;

    // 12. Update played_cards (all cards played so far)
    const updatedPlayedCards = [...played_cards, ...cards];

    // 13. Detect highest play and create auto-pass timer
    const isHighestPlay = isHighestPossiblePlay(cards, updatedPlayedCards);
    let autoPassTimerState = null;

    if (isHighestPlay) {
      const serverTimeMs = Date.now();
      const durationMs = 10000; // 10 seconds
      const endTimestamp = serverTimeMs + durationMs;
      const existingSequenceId = (gameState.auto_pass_timer as any)?.sequence_id || 0;
      const sequenceId = existingSequenceId + 1;

      autoPassTimerState = {
        active: true,
        started_at: new Date(serverTimeMs).toISOString(),
        duration_ms: durationMs,
        remaining_ms: durationMs,
        end_timestamp: endTimestamp,
        sequence_id: sequenceId,
        server_time_at_creation: serverTimeMs,
        triggering_play: {
          position: player.player_index,
          cards,
          combo_type: comboType,
        },
        player_id: player.user_id,
      };

      console.log('⏰ Auto-pass timer created (highest play detected):', {
        serverTimeMs,
        endTimestamp,
        sequenceId,
        cards: cards.map(c => c.id),
      });
    }

    // 14. Update game state (including timer)
    const { error: updateError } = await supabaseClient
      .from('game_state')
      .update({
        hands: updatedHands,
        last_play: {
          player_index: player.player_index,
          cards,
          combo_type: comboType,
          timestamp: Date.now(),
        },
        current_turn: nextTurn,
        pass_count: 0,
        played_cards: updatedPlayedCards,
        auto_pass_timer: autoPassTimerState,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', room.id);

    if (updateError) {
      console.error('Failed to update game state:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update game state' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 15. Success response (includes timer state and match scores)
    return new Response(
      JSON.stringify({
        success: true,
        next_turn: nextTurn,
        combo_type: comboType,
        cards_remaining: updatedHand.length,
        match_ended: matchEnded,
        auto_pass_timer: autoPassTimerState,
        highest_play_detected: isHighestPlay,
        match_scores: matchScores,
        game_over: gameOver,
        final_winner_index: finalWinnerIndex,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('play-cards error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
