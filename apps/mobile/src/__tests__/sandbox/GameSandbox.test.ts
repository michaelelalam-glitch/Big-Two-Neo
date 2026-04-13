/**
 * Sandbox Tests — Full-control game testing
 *
 * Tests every edge function scenario with full state control:
 *  - Custom hands, scores, and played cards
 *  - Rule validation (3♦ first play, pass restrictions, one-card-left)
 *  - Score state management (pre-set cumulative scores)
 *  - Bot AI behavior at all difficulties
 *  - Multi-game simulation (20+ concurrent)
 *  - Combo classification for all 8 types
 *  - Highest play detection
 *  - Turn advancement and trick resolution
 */

import { GameSandbox, MultiGameRunner, card, cards, fullDeck, dealCards } from './GameSandbox';
import { classifyCards, canBeatPlay, sortHand } from '../../game/engine';
import type { Card, ComboType, LastPlay } from '../../game/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000;

// ─── 1. Sandbox Creation & Configuration ─────────────────────────────────────

describe('GameSandbox: creation', () => {
  it('creates a 4-player game with dealt hands', () => {
    const sb = GameSandbox.create();
    expect(sb.state.players).toHaveLength(4);
    sb.state.players.forEach(p => {
      expect(p.hand.length).toBe(13);
    });
    expect(sb.state.gameStarted).toBe(true);
    expect(sb.state.gameEnded).toBe(false);
  });

  it('creates a 2-player game', () => {
    const sb = GameSandbox.create({ players: 2 });
    expect(sb.state.players).toHaveLength(2);
    expect(sb.state.players[0].hand.length).toBe(13);
    expect(sb.state.players[1].hand.length).toBe(13);
  });

  it('creates a 3-player game', () => {
    const sb = GameSandbox.create({ players: 3 });
    expect(sb.state.players).toHaveLength(3);
    // 13 per player, matching production (CARDS_PER_PLAYER)
    const totalCards = sb.state.players.reduce((s, p) => s + p.hand.length, 0);
    expect(totalCards).toBe(39);
  });

  it('rejects invalid player counts', () => {
    expect(() => GameSandbox.create({ players: 1 })).toThrow();
    expect(() => GameSandbox.create({ players: 5 })).toThrow();
  });

  it('assigns custom hands', () => {
    const h0 = cards('3D', '4D', '5D');
    const h1 = cards('3C', '4C', '5C');
    const sb = GameSandbox.create({
      players: 2,
      hands: { 0: h0, 1: h1 },
    });
    expect(sb.state.players[0].hand).toEqual(h0);
    expect(sb.state.players[1].hand).toEqual(h1);
  });

  it('assigns pre-set scores', () => {
    const sb = GameSandbox.create({
      scores: { player_0: 50, player_1: 90 },
    });
    expect(sb.getScore('player_0')).toBe(50);
    expect(sb.getScore('player_1')).toBe(90);
  });

  it('creates bots with specified difficulty', () => {
    const sb = GameSandbox.create({
      bots: { 1: 'easy', 2: 'medium', 3: 'hard' },
    });
    expect(sb.state.players[0].isBot).toBe(false);
    expect(sb.state.players[1].isBot).toBe(true);
    expect(sb.state.players[1].botDifficulty).toBe('easy');
    expect(sb.state.players[2].botDifficulty).toBe('medium');
    expect(sb.state.players[3].botDifficulty).toBe('hard');
  });

  it('starts with the player holding 3♦', () => {
    const sb = GameSandbox.create({
      players: 4,
      hands: {
        0: cards('4D', '5D'),
        1: cards('3D', '6D'),
        2: cards('7D', '8D'),
        3: cards('9D', '10D'),
      },
    });
    expect(sb.state.currentPlayerIndex).toBe(1); // player 1 has 3♦
  });

  it('allows starting player override', () => {
    const sb = GameSandbox.create({
      players: 4,
      startingPlayerIndex: 2,
    });
    expect(sb.state.currentPlayerIndex).toBe(2);
  });
});

// ─── 2. State Mutation ───────────────────────────────────────────────────────

describe('GameSandbox: state mutation', () => {
  it('setHand replaces player hand', () => {
    const sb = GameSandbox.create();
    const newHand = cards('AS', '2S', 'KS');
    sb.setHand(0, newHand);
    expect(sb.state.players[0].hand).toEqual(newHand);
  });

  it('setHand by player id', () => {
    const sb = GameSandbox.create();
    sb.setHand('player_0', cards('3D'));
    expect(sb.state.players[0].hand).toEqual(cards('3D'));
  });

  it('setScores updates cumulative scores', () => {
    const sb = GameSandbox.create();
    sb.setScores({ player_0: 100, player_1: 50 });
    expect(sb.getScore('player_0')).toBe(100);
    expect(sb.getScore('player_1')).toBe(50);
  });

  it('setCurrentPlayer changes turn', () => {
    const sb = GameSandbox.create({ startingPlayerIndex: 0 });
    sb.setCurrentPlayer(3);
    expect(sb.state.currentPlayerIndex).toBe(3);
  });

  it('setLastPlay overrides trick to beat', () => {
    const sb = GameSandbox.create();
    sb.setLastPlay({ cards: cards('KS'), combo_type: 'Single' });
    expect(sb.state.lastPlay).toBeTruthy();
    expect(sb.state.lastPlay!.cards[0].id).toBe('KS');
  });

  it('setIsFirstPlay toggles first play flag', () => {
    const sb = GameSandbox.create();
    expect(sb.state.isFirstPlayOfGame).toBe(true);
    sb.setIsFirstPlay(false);
    expect(sb.state.isFirstPlayOfGame).toBe(false);
  });

  it('setPlayedCards tracks played cards', () => {
    const sb = GameSandbox.create();
    sb.setPlayedCards(cards('3D', '4D', '5D'));
    expect(sb.state.played_cards).toHaveLength(3);
  });

  it('resetPasses clears all pass states', () => {
    const sb = GameSandbox.create({ startingPlayerIndex: 0 });
    sb.setIsFirstPlay(false);
    sb.setLastPlay({ cards: cards('5D'), combo_type: 'Single' });
    sb.setHand(0, cards('3D')); // weak card, will want to pass
    sb.pass(0);
    expect(sb.state.consecutivePasses).toBeGreaterThan(0);
    sb.resetPasses();
    expect(sb.state.consecutivePasses).toBe(0);
    sb.state.players.forEach(p => expect(p.passed).toBe(false));
  });

  it('snapshot creates deep copy', () => {
    const sb = GameSandbox.create();
    const snap = sb.snapshot();
    sb.setHand(0, []);
    expect(snap.players[0].hand.length).toBeGreaterThan(0);
  });
});

// ─── 3. Play Cards Validation ────────────────────────────────────────────────

describe('GameSandbox: playCards', () => {
  it('rejects play when not your turn', () => {
    const sb = GameSandbox.create({ startingPlayerIndex: 0 });
    const result = sb.playCards(1, cards('4D'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not your turn');
  });

  it('rejects empty selection', () => {
    const sb = GameSandbox.create({ startingPlayerIndex: 0 });
    const result = sb.playCards(0, []);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Must select');
  });

  it('rejects invalid combo', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D', '5H', '7S', '9C') },
    });
    sb.setIsFirstPlay(false);
    const result = sb.playCards(0, cards('3D', '7S')); // Not a pair
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('enforces 3♦ on first play', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: {
        0: cards('3D', '4D', '5D', '6D', '7D', '8D', '9D', '10D', 'JD', 'QD', 'KD', 'AD', '2D'),
      },
    });
    // Try to play without 3♦
    const result = sb.playCards(0, cards('4D'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('3♦');
  });

  it('allows disabling 3♦ first play rule', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('4D', '5D') },
      enforceFirstPlayRule: false,
    });
    const result = sb.playCards(0, cards('4D'));
    expect(result.success).toBe(true);
  });

  it('plays a valid single', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D', '4D') },
    });
    const result = sb.playCards(0, cards('3D'));
    expect(result.success).toBe(true);
    expect(result.comboType).toBe('Single');
    expect(sb.state.players[0].hand).toEqual(cards('4D'));
  });

  it('rejects weaker play against existing trick', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D', 'AS'), 1: cards('4D', '5D') },
      players: 2,
    });
    sb.setIsFirstPlay(false);
    sb.playCards(0, cards('AS'));
    // Player 1 tries to beat Ace with 4
    const result = sb.playCards(1, cards('4D'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot beat');
  });

  it('removes played cards from hand', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D', '3C', '4D') },
    });
    sb.playCards(0, cards('3D'));
    expect(sb.state.players[0].hand.map(c => c.id)).toEqual(['3C', '4D']);
  });

  it('records play in round history', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D', '4D') },
    });
    sb.playCards(0, cards('3D'));
    expect(sb.state.roundHistory).toHaveLength(1);
    expect(sb.state.roundHistory[0].combo_type).toBe('Single');
    expect(sb.state.roundHistory[0].passed).toBe(false);
  });

  it('adds played cards to played_cards tracker', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D', '4D') },
    });
    sb.playCards(0, cards('3D'));
    expect(sb.state.played_cards.map(c => c.id)).toContain('3D');
  });

  it('advances turn after play', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D', '4D') },
    });
    sb.playCards(0, cards('3D'));
    // 4-player anticlockwise turn order: 0→3→1→2 (matches production TURN_ORDER)
    expect(sb.state.currentPlayerIndex).toBe(3);
  });

  it('detects win when hand empties', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D') },
    });
    sb.playCards(0, cards('3D'));
    expect(sb.state.gameEnded).toBe(true);
    expect(sb.state.winnerId).toBe('player_0');
  });
});

// ─── 4. Pass Validation ──────────────────────────────────────────────────────

describe('GameSandbox: pass', () => {
  it('rejects pass when not your turn', () => {
    const sb = GameSandbox.create({ startingPlayerIndex: 0 });
    sb.setIsFirstPlay(false);
    sb.setLastPlay({ cards: cards('KS'), combo_type: 'Single' });
    const result = sb.pass(1);
    expect(result.success).toBe(false);
  });

  it('rejects pass when leading (no last play)', () => {
    const sb = GameSandbox.create({ startingPlayerIndex: 0 });
    sb.setIsFirstPlay(false);
    const result = sb.pass(0);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot pass when leading');
  });

  it('allows valid pass', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D', '4D') },
    });
    sb.setIsFirstPlay(false);
    sb.setLastPlay({ cards: cards('2S'), combo_type: 'Single' });
    const result = sb.pass(0);
    expect(result.success).toBe(true);
    expect(sb.state.consecutivePasses).toBe(1);
  });

  it('records pass in history', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D', '4D') },
    });
    sb.setIsFirstPlay(false);
    sb.setLastPlay({ cards: cards('2S'), combo_type: 'Single' });
    sb.pass(0);
    expect(sb.state.roundHistory).toHaveLength(1);
    expect(sb.state.roundHistory[0].passed).toBe(true);
  });

  it('all players pass → trick winner leads', () => {
    const sb = GameSandbox.create({
      players: 3,
      startingPlayerIndex: 0,
      hands: {
        0: cards(
          'KS',
          '5D',
          '6D',
          '7D',
          '8D',
          '9D',
          '10D',
          'JD',
          'QD',
          'KD',
          'AD',
          '2D',
          '3D',
          '4D',
          '5S',
          '6S',
          '7S'
        ),
        1: cards(
          '3C',
          '4C',
          '5C',
          '6C',
          '7C',
          '8C',
          '9C',
          '10C',
          'JC',
          'QC',
          'KC',
          'AC',
          '2C',
          '3H',
          '4H',
          '5H',
          '6H',
          '7H'
        ),
        2: cards(
          '3S',
          '4S',
          '8S',
          '9S',
          '10S',
          'JS',
          'QS',
          'AS',
          '2S',
          '8H',
          '9H',
          '10H',
          'JH',
          'QH',
          'KH',
          'AH',
          '2H'
        ),
      },
      enforceFirstPlayRule: false,
    });
    sb.setIsFirstPlay(false);

    // Player 0 plays KS
    sb.playCards(0, cards('KS'));
    expect(sb.state.currentPlayerIndex).toBe(1);

    // Player 1 passes
    sb.pass(1);
    expect(sb.state.currentPlayerIndex).toBe(2);

    // Player 2 passes → trick complete, player 0 leads
    sb.pass(2);
    expect(sb.state.currentPlayerIndex).toBe(0);
    expect(sb.state.lastPlay).toBeNull();
    expect(sb.state.consecutivePasses).toBe(0);
  });
});

// ─── 5. Combo Classification ─────────────────────────────────────────────────

describe('GameSandbox: combo classification', () => {
  it('classifies single', () => {
    expect(classifyCards(cards('3D'))).toBe('Single');
  });

  it('classifies pair', () => {
    expect(classifyCards(cards('3D', '3C'))).toBe('Pair');
  });

  it('classifies triple', () => {
    expect(classifyCards(cards('3D', '3C', '3H'))).toBe('Triple');
  });

  it('classifies straight', () => {
    expect(classifyCards(cards('3D', '4C', '5H', '6S', '7D'))).toBe('Straight');
  });

  it('classifies flush', () => {
    expect(classifyCards(cards('3D', '5D', '7D', '9D', 'JD'))).toBe('Flush');
  });

  it('classifies full house', () => {
    expect(classifyCards(cards('3D', '3C', '3H', '4D', '4C'))).toBe('Full House');
  });

  it('classifies four of a kind', () => {
    expect(classifyCards(cards('3D', '3C', '3H', '3S', '4D'))).toBe('Four of a Kind');
  });

  it('classifies straight flush', () => {
    expect(classifyCards(cards('3D', '4D', '5D', '6D', '7D'))).toBe('Straight Flush');
  });

  it('rejects invalid 2-card combo that is not a pair', () => {
    expect(classifyCards(cards('3D', '5C'))).toBe('unknown');
  });

  it('rejects invalid 4-card combo', () => {
    expect(classifyCards(cards('3D', '4D', '5D', '6D'))).toBe('unknown');
  });

  it('classifies A-2-3-4-5 as straight (A low)', () => {
    expect(classifyCards(cards('AD', '2C', '3H', '4S', '5D'))).toBe('Straight');
  });

  it('classifies 2-3-4-5-6 as straight (2 low)', () => {
    expect(classifyCards(cards('2D', '3C', '4H', '5S', '6D'))).toBe('Straight');
  });

  it('classifies 10-J-Q-K-A as straight (A high)', () => {
    expect(classifyCards(cards('10D', 'JC', 'QH', 'KS', 'AD'))).toBe('Straight');
  });

  it('rejects J-Q-K-A-2 (wrap-around is invalid)', () => {
    expect(classifyCards(cards('JD', 'QC', 'KH', 'AS', '2D'))).toBe('unknown');
  });
});

// ─── 6. Beat Play Logic ──────────────────────────────────────────────────────

describe('GameSandbox: beat play', () => {
  /** Helper to build a LastPlay (Card and LastPlay are imported from ../../game/types) */
  const lp = (c: Card[], combo: ComboType = 'Single'): LastPlay => ({
    cards: c,
    combo_type: combo,
  });

  it('higher single beats lower single', () => {
    expect(canBeatPlay(cards('4D'), lp(cards('3D')))).toBe(true);
  });

  it('lower single cannot beat higher single', () => {
    expect(canBeatPlay(cards('3D'), lp(cards('4D')))).toBe(false);
  });

  it('same rank higher suit beats same rank lower suit', () => {
    expect(canBeatPlay(cards('3S'), lp(cards('3D')))).toBe(true);
  });

  it('pair beats pair of lower rank', () => {
    expect(canBeatPlay(cards('4D', '4C'), lp(cards('3D', '3C'), 'Pair'))).toBe(true);
  });

  it('pair cannot beat different combo size', () => {
    // canBeatPlay should reject mismatched sizes
    expect(canBeatPlay(cards('4D', '4C'), lp(cards('3D')))).toBe(false);
  });

  it('2S (highest single) beats any single', () => {
    expect(canBeatPlay(cards('2S'), lp(cards('2H')))).toBe(true);
    expect(canBeatPlay(cards('2S'), lp(cards('AD')))).toBe(true);
  });

  it('straight flush beats four of a kind', () => {
    const sf = cards('3D', '4D', '5D', '6D', '7D');
    const foak = cards('3D', '3C', '3H', '3S', '4D');
    const sfType = classifyCards(sf);
    const foakType = classifyCards(foak);
    expect(sfType).toBe('Straight Flush');
    expect(foakType).toBe('Four of a Kind');
    expect(canBeatPlay(sf, lp(foak, 'Four of a Kind'))).toBe(true);
  });
});

// ─── 7. Bot AI ───────────────────────────────────────────────────────────────

describe('GameSandbox: bot play', () => {
  it('easy bot plays or passes', () => {
    const sb = GameSandbox.create({
      bots: { 0: 'easy', 1: 'easy', 2: 'easy', 3: 'easy' },
    });
    sb.setIsFirstPlay(false);
    sb.setLastPlay({ cards: cards('5D'), combo_type: 'Single' });
    const result = sb.runBotTurn();
    expect(['play', 'pass']).toContain(result.action);
  });

  it('medium bot plays or passes', () => {
    const sb = GameSandbox.create({
      bots: { 0: 'medium', 1: 'medium', 2: 'medium', 3: 'medium' },
    });
    sb.setIsFirstPlay(false);
    sb.setLastPlay({ cards: cards('5D'), combo_type: 'Single' });
    const result = sb.runBotTurn();
    expect(['play', 'pass']).toContain(result.action);
  });

  it('hard bot plays or passes', () => {
    const sb = GameSandbox.create({
      bots: { 0: 'hard', 1: 'hard', 2: 'hard', 3: 'hard' },
    });
    sb.setIsFirstPlay(false);
    sb.setLastPlay({ cards: cards('5D'), combo_type: 'Single' });
    const result = sb.runBotTurn();
    expect(['play', 'pass']).toContain(result.action);
  });

  it('bot must play when leading', () => {
    const sb = GameSandbox.create({
      bots: { 0: 'easy', 1: 'easy', 2: 'easy', 3: 'easy' },
    });
    sb.setIsFirstPlay(false);
    // No last play = must play
    const result = sb.runBotTurn();
    expect(result.action).toBe('play');
  });

  it('throws error for non-bot player', () => {
    const sb = GameSandbox.create({ startingPlayerIndex: 0 });
    expect(() => sb.runBotTurn()).toThrow('not a bot');
  });
});

// ─── 8. Full Game Simulation ─────────────────────────────────────────────────

describe('GameSandbox: full game simulation', () => {
  it(
    'completes a 4-bot game',
    () => {
      const sb = GameSandbox.create({
        bots: { 0: 'easy', 1: 'easy', 2: 'easy', 3: 'easy' },
      });
      let turns = 0;
      while (!sb.state.gameEnded && turns < 500) {
        sb.runBotTurn();
        turns++;
      }
      expect(sb.state.gameEnded).toBe(true);
      expect(sb.state.winnerId).toBeTruthy();
    },
    TIMEOUT_MS
  );

  it(
    'completes a 2-bot game',
    () => {
      const sb = GameSandbox.create({
        players: 2,
        bots: { 0: 'medium', 1: 'medium' },
      });
      let turns = 0;
      while (!sb.state.gameEnded && turns < 500) {
        sb.runBotTurn();
        turns++;
      }
      expect(sb.state.gameEnded).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    'completes a 3-bot game',
    () => {
      const sb = GameSandbox.create({
        players: 3,
        bots: { 0: 'hard', 1: 'hard', 2: 'hard' },
      });
      let turns = 0;
      while (!sb.state.gameEnded && turns < 500) {
        sb.runBotTurn();
        turns++;
      }
      expect(sb.state.gameEnded).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    'winner has empty hand',
    () => {
      const sb = GameSandbox.create({
        bots: { 0: 'easy', 1: 'easy', 2: 'easy', 3: 'easy' },
      });
      let turns = 0;
      while (!sb.state.gameEnded && turns < 500) {
        sb.runBotTurn();
        turns++;
      }
      const winner = sb.state.players.find(p => p.id === sb.state.winnerId);
      expect(winner?.hand.length).toBe(0);
    },
    TIMEOUT_MS
  );
});

// ─── 9. Scoring Edge Cases ───────────────────────────────────────────────────

describe('GameSandbox: scoring', () => {
  it('tracks scores set before game', () => {
    const sb = GameSandbox.create({
      scores: { player_0: 99, player_1: 50 },
    });
    expect(sb.getScore('player_0')).toBe(99);
    expect(sb.getScore('player_1')).toBe(50);
  });

  it('returns 0 for unknown player', () => {
    const sb = GameSandbox.create();
    expect(sb.getScore('nonexistent')).toBe(0);
  });

  it('can set scores above game-end threshold', () => {
    const sb = GameSandbox.create({
      scores: { player_0: 150 },
    });
    expect(sb.getScore('player_0')).toBe(150);
  });
});

// ─── 10. Valid Plays Query ───────────────────────────────────────────────────

describe('GameSandbox: getValidPlays', () => {
  it('finds singles when leading', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D', '5D', 'AS') },
      enforceFirstPlayRule: false,
    });
    sb.setIsFirstPlay(false);
    const plays = sb.getValidPlays(0);
    const singles = plays.filter(p => p.length === 1);
    expect(singles.length).toBe(3); // 3D, 5D, AS
  });

  it('finds beating singles', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D', '5D', 'AS') },
      enforceFirstPlayRule: false,
    });
    sb.setIsFirstPlay(false);
    sb.setLastPlay({ cards: cards('4D'), combo_type: 'Single' });
    const plays = sb.getValidPlays(0);
    const singles = plays.filter(p => p.length === 1);
    expect(singles.length).toBe(2); // 5D and AS beat 4D
  });

  it('finds pairs', () => {
    const sb = GameSandbox.create({
      startingPlayerIndex: 0,
      hands: { 0: cards('3D', '3C', '5D') },
      enforceFirstPlayRule: false,
    });
    sb.setIsFirstPlay(false);
    const plays = sb.getValidPlays(0);
    const pairs = plays.filter(p => p.length === 2);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 11. Highest Play Detection ──────────────────────────────────────────────

describe('GameSandbox: highest play detection', () => {
  it('2S is highest single when no 2s played', () => {
    const sb = GameSandbox.create();
    sb.setPlayedCards([]);
    expect(sb.checkHighestPlay(cards('2S'))).toBe(true);
  });

  it('AS is not highest single when 2s remain', () => {
    const sb = GameSandbox.create();
    sb.setPlayedCards([]);
    // AS is not highest when 2S hasn't been played
    expect(sb.checkHighestPlay(cards('AS'))).toBe(false);
  });
});

// ─── 12. Multi-Game Runner ───────────────────────────────────────────────────

describe('MultiGameRunner', () => {
  it('creates 20 concurrent games', () => {
    const runner = new MultiGameRunner();
    const ids = runner.createGames(20, {
      bots: { 0: 'easy', 1: 'easy', 2: 'easy', 3: 'easy' },
    });
    expect(ids).toHaveLength(20);
    runner.clear();
  });

  it('runs all 20 games to completion', () => {
    const runner = new MultiGameRunner();
    runner.createGames(20, {
      bots: { 0: 'easy', 1: 'easy', 2: 'easy', 3: 'easy' },
    });
    const results = runner.runAllToCompletion();
    expect(results.size).toBe(20);
    for (const [, result] of results) {
      expect(result.winnerId).toBeTruthy();
      expect(result.turns).toBeGreaterThan(0);
    }
    runner.clear();
  }, 30_000);

  it('provides aggregate stats', () => {
    const runner = new MultiGameRunner();
    runner.createGames(10, {
      bots: { 0: 'easy', 1: 'easy', 2: 'easy', 3: 'easy' },
    });
    runner.runAllToCompletion();
    const stats = runner.getAggregateStats();
    expect(stats.totalGames).toBe(10);
    expect(stats.completed).toBe(10);
    expect(stats.avgTurns).toBeGreaterThan(0);
    runner.clear();
  }, 30_000);

  it('supports per-game config overrides', () => {
    const runner = new MultiGameRunner();
    runner.createGames(5, {}, i => ({
      players: i < 3 ? 4 : 2,
      bots: i < 3 ? { 0: 'easy', 1: 'easy', 2: 'easy', 3: 'easy' } : { 0: 'hard', 1: 'hard' },
    }));
    expect(runner.getGame('game-0').state.players).toHaveLength(4);
    expect(runner.getGame('game-3').state.players).toHaveLength(2);
    runner.clear();
  });

  it('runs 25 games simultaneously (stress test)', () => {
    const runner = new MultiGameRunner();
    runner.createGames(25, {
      bots: { 0: 'medium', 1: 'medium', 2: 'medium', 3: 'medium' },
    });
    const results = runner.runAllToCompletion();
    let completedCount = 0;
    for (const [, result] of results) {
      if (result.winnerId) completedCount++;
    }
    expect(completedCount).toBe(25);
    runner.clear();
  }, 60_000);
});

// ─── 13. Edge Cases & Regression Tests ───────────────────────────────────────

describe('GameSandbox: edge cases', () => {
  it('handles player with 1 card winning', () => {
    const sb = GameSandbox.create({
      players: 2,
      startingPlayerIndex: 0,
      hands: {
        0: cards('2S'),
        1: cards('3D', '4D', '5D'),
      },
      enforceFirstPlayRule: false,
    });
    sb.setIsFirstPlay(false);
    sb.playCards(0, cards('2S'));
    expect(sb.state.gameEnded).toBe(true);
    expect(sb.state.winnerId).toBe('player_0');
  });

  it('full deck has 52 unique cards', () => {
    const deck = fullDeck();
    expect(deck).toHaveLength(52);
    const ids = new Set(deck.map(c => c.id));
    expect(ids.size).toBe(52);
  });

  it('dealCards distributes all cards', () => {
    const hands = dealCards(4);
    const total = hands.reduce((s, h) => s + h.length, 0);
    expect(total).toBe(52);
    expect(hands[0].length).toBe(13);
    expect(hands[1].length).toBe(13);
    expect(hands[2].length).toBe(13);
    expect(hands[3].length).toBe(13);
  });

  it('card factory validates input', () => {
    expect(() => card('XY')).toThrow();
    expect(() => card('')).toThrow();
    expect(() => card('11D')).toThrow();
    expect(card('10D').rank).toBe('10');
    expect(card('JH').rank).toBe('J');
    expect(card('2S').suit).toBe('S');
  });

  it('turn skips players with empty hands', () => {
    const sb = GameSandbox.create({
      players: 3,
      startingPlayerIndex: 0,
      hands: {
        0: cards('3D', '5D'),
        1: [], // Empty hand — already won
        2: cards('4D', '6D'),
      },
      enforceFirstPlayRule: false,
    });
    sb.setIsFirstPlay(false);
    sb.playCards(0, cards('3D'));
    // Should skip player 1 (empty hand) and go to player 2
    expect(sb.state.currentPlayerIndex).toBe(2);
  });

  it('consecutive passes across all players resets trick', () => {
    const sb = GameSandbox.create({
      players: 2,
      startingPlayerIndex: 0,
      hands: {
        0: cards('KS', '3D'),
        1: cards('3C', '4C'),
      },
      enforceFirstPlayRule: false,
    });
    sb.setIsFirstPlay(false);
    sb.playCards(0, cards('KS'));
    // Player 1 passes
    sb.pass(1);
    // Only 1 other player → passes = activePlayers - 1 = 1
    // Trick complete, player 0 leads again
    expect(sb.state.currentPlayerIndex).toBe(0);
    expect(sb.state.lastPlay).toBeNull();
  });
});

// ─── 14. Card Utility Tests ──────────────────────────────────────────────────

describe('Card utilities', () => {
  it('sortHand sorts by rank then suit', () => {
    const sorted = sortHand(cards('AS', '3D', 'KH', '3C'));
    expect(sorted[0].id).toBe('3D');
    expect(sorted[1].id).toBe('3C');
    expect(sorted[2].id).toBe('KH');
    expect(sorted[3].id).toBe('AS');
  });

  it('sortHand handles empty array', () => {
    expect(sortHand([])).toEqual([]);
  });

  it('classifyCards handles empty array', () => {
    const result = classifyCards([]);
    expect(result).toBe('unknown');
  });
});
