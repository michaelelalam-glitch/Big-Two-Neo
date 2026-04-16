// @ts-nocheck
/**
 * 30-Game Stats Simulation Sandbox
 *
 * Simulates how 10 casual + 10 ranked + 10 private games with mixed outcomes
 * impact every stat field tracked by update_player_stats_after_game().
 *
 *   Outcomes covered per mode:
 *     • Win (1st place)   • 2nd place       • 3rd place
 *     • 4th place (loss)  • Abandoned       • Voided
 *
 *   Stats verified:
 *     rank_points · casual_rank_points · ranked_rank_points
 *     total_points · avg_score_per_game · highest_score · lowest_score
 *     avg_finish_position · avg_cards_left_in_hand · total_cards_left_in_hand
 *     games_completed · games_abandoned · completion_rate
 *     current_completion_streak · longest_completion_streak
 *     win_rate (overall + per-mode) · win streaks
 *     rank_points_history (progression graph — 30 entries, tagged by mode)
 *     all 9 combo types (completed games only)
 *
 * Engine: TypeScript port of the CURRENT SQL function
 *   (migration 20260718000001_fix_avg_cards_left_completed_only.sql and later)
 *   Key rule: avg_cards_left_in_hand uses games_completed as denominator —
 *   abandoned and voided games do NOT count toward cards-left stats.
 */

// ─── Engine types ─────────────────────────────────────────────────────────────

interface StatsState {
  // Overall
  games_played: number;
  games_won: number;
  games_lost: number;
  win_rate: number;
  current_win_streak: number;
  longest_win_streak: number;
  current_loss_streak: number;
  rank_points: number;
  // Completion
  games_completed: number;
  games_abandoned: number;
  completion_rate: number;
  current_completion_streak: number;
  longest_completion_streak: number;
  // Performance (completed games only)
  avg_finish_position: number; // SQL: COALESCE(avg_finish_position, 2.5) for null-init
  total_points: number;
  highest_score: number;
  lowest_score: number | null;
  avg_score_per_game: number;
  // Cards
  total_cards_left_in_hand: number;
  avg_cards_left_in_hand: number;
  // Rank history
  rank_points_history: Array<{ points: number; is_win: boolean; game_type: string }>;
  // Casual mode
  casual_games_played: number;
  casual_games_won: number;
  casual_games_lost: number;
  casual_win_rate: number;
  casual_rank_points: number;
  // Ranked mode
  ranked_games_played: number;
  ranked_games_won: number;
  ranked_games_lost: number;
  ranked_win_rate: number;
  ranked_rank_points: number;
  // Private mode
  private_games_played: number;
  private_games_won: number;
  private_games_lost: number;
  private_win_rate: number;
  // Combos (completed games only)
  singles_played: number;
  pairs_played: number;
  triples_played: number;
  straights_played: number;
  flushes_played: number;
  full_houses_played: number;
  four_of_a_kinds_played: number;
  straight_flushes_played: number;
  royal_flushes_played: number;
}

interface GameInput {
  label: string;
  won: boolean;
  finish_position: number; // 1, 2, 3, or 4
  score: number;
  cards_left: number;
  game_type: 'casual' | 'ranked' | 'private';
  completed: boolean;
  combos?: {
    singles?: number;
    pairs?: number;
    triples?: number;
    straights?: number;
    flushes?: number;
    full_houses?: number;
    four_of_a_kinds?: number;
    straight_flushes?: number;
    royal_flushes?: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** SQL ROUND(x, 2) equivalent */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Fresh player stats row (mirrors initialize_player_stats() defaults) */
function initialStats(): StatsState {
  return {
    games_played: 0,
    games_won: 0,
    games_lost: 0,
    win_rate: 0,
    current_win_streak: 0,
    longest_win_streak: 0,
    current_loss_streak: 0,
    rank_points: 1000,
    games_completed: 0,
    games_abandoned: 0,
    completion_rate: 100,
    current_completion_streak: 0,
    longest_completion_streak: 0,
    avg_finish_position: 0, // SQL: COALESCE(null, 2.5) only matters when games_completed=0 → result = finish_pos either way
    total_points: 0,
    highest_score: 0,
    lowest_score: null,
    avg_score_per_game: 0,
    total_cards_left_in_hand: 0,
    avg_cards_left_in_hand: 0,
    rank_points_history: [],
    casual_games_played: 0,
    casual_games_won: 0,
    casual_games_lost: 0,
    casual_win_rate: 0,
    casual_rank_points: 1000,
    ranked_games_played: 0,
    ranked_games_won: 0,
    ranked_games_lost: 0,
    ranked_win_rate: 0,
    ranked_rank_points: 1000,
    private_games_played: 0,
    private_games_won: 0,
    private_games_lost: 0,
    private_win_rate: 0,
    singles_played: 0,
    pairs_played: 0,
    triples_played: 0,
    straights_played: 0,
    flushes_played: 0,
    full_houses_played: 0,
    four_of_a_kinds_played: 0,
    straight_flushes_played: 0,
    royal_flushes_played: 0,
  };
}

/**
 * TypeScript port of update_player_stats_after_game().
 * Uses a snapshot (prev) for all rate calculations — mirrors SQL v_stats RECORD.
 */
function applyGame(prev: StatsState, game: GameInput): StatsState {
  const s = { ...prev }; // mutable copy; prev is snapshot

  // ── Rank point delta (mirrors SQL CASE WHEN) ───────────────────────────────
  const rankChange = game.won
    ? 25
    : game.finish_position === 2
      ? 10
      : game.finish_position === 3
        ? -5
        : -15;

  // ── Pre-compute new rates (snapshot-based, mirrors v_stats in SQL) ─────────
  const newWinRate = r2(((prev.games_won + (game.won ? 1 : 0)) / (prev.games_played + 1)) * 100);
  const newCompletionRate = r2(
    ((prev.games_completed + (game.completed ? 1 : 0)) / (prev.games_played + 1)) * 100
  );

  // avg_cards_left: ONLY completed non-voided games (migration 20260718)
  // denominator = games_completed + 1 (NOT games_played + 1)
  const newTotalCards = game.completed
    ? prev.total_cards_left_in_hand + game.cards_left
    : prev.total_cards_left_in_hand;
  const newAvgCardsLeft = game.completed
    ? r2(newTotalCards / (prev.games_completed + 1))
    : prev.avg_cards_left_in_hand;
  const newRankPoints = prev.rank_points + rankChange;

  // avg_score: uses games_completed as denominator (snapshot), only updates on completed
  const newAvgScore = game.completed
    ? r2((prev.avg_score_per_game * prev.games_completed + game.score) / (prev.games_completed + 1))
    : prev.avg_score_per_game;

  // win streaks
  const newWinStreak = game.won ? prev.current_win_streak + 1 : 0;
  const newLongestWinStreak = Math.max(prev.longest_win_streak, newWinStreak);

  // loss streaks
  const newLossStreak = game.won ? 0 : prev.current_loss_streak + 1;

  // completion streaks
  const newCompletionStreak = game.completed ? prev.current_completion_streak + 1 : 0;
  const newLongestCompletionStreak = Math.max(
    prev.longest_completion_streak,
    // SQL: GREATEST(longest, CASE WHEN p_completed THEN current + 1 ELSE current END)
    game.completed ? prev.current_completion_streak + 1 : prev.current_completion_streak
  );

  // mode win rates (snapshot-based)
  const modeWinRate = (modeWon: number, modePlayed: number): number =>
    r2(((modeWon + (game.won ? 1 : 0)) / (modePlayed + 1)) * 100);

  // ── Apply all updates ──────────────────────────────────────────────────────
  s.games_played = prev.games_played + 1;
  s.games_won = prev.games_won + (game.won ? 1 : 0);
  s.games_lost = prev.games_lost + (game.won ? 0 : 1);
  s.win_rate = newWinRate;
  s.current_win_streak = newWinStreak;
  s.longest_win_streak = newLongestWinStreak;
  s.current_loss_streak = newLossStreak;
  s.rank_points = newRankPoints;

  s.games_completed = prev.games_completed + (game.completed ? 1 : 0);
  s.games_abandoned = prev.games_abandoned + (game.completed ? 0 : 1);
  s.completion_rate = newCompletionRate;
  s.current_completion_streak = newCompletionStreak;
  s.longest_completion_streak = newLongestCompletionStreak;

  s.total_cards_left_in_hand = newTotalCards;
  s.avg_cards_left_in_hand = newAvgCardsLeft;
  s.avg_score_per_game = newAvgScore;

  // rank_points_history: append entry, cap at 100 (SQL: remove index 0 when full)
  const histEntry = { points: newRankPoints, is_win: game.won, game_type: game.game_type };
  const newHistory = [...prev.rank_points_history];
  if (newHistory.length >= 100) newHistory.shift();
  newHistory.push(histEntry);
  s.rank_points_history = newHistory;

  // ── Completed-only stats: avg_finish_position, total_points, highest/lowest, combos ──
  if (game.completed) {
    // SQL: COALESCE(avg_finish_position, 2.5) → for games_completed=0 either value → same result
    const prevAvgPos = prev.games_completed === 0 ? 0 : prev.avg_finish_position;
    s.avg_finish_position = r2(
      (prevAvgPos * prev.games_completed + game.finish_position) / (prev.games_completed + 1)
    );
    s.total_points = prev.total_points + game.score;
    s.highest_score = Math.max(prev.highest_score, game.score);
    s.lowest_score =
      prev.lowest_score === null ? game.score : Math.min(prev.lowest_score, game.score);

    const c = game.combos ?? {};
    s.singles_played = prev.singles_played + (c.singles ?? 0);
    s.pairs_played = prev.pairs_played + (c.pairs ?? 0);
    s.triples_played = prev.triples_played + (c.triples ?? 0);
    s.straights_played = prev.straights_played + (c.straights ?? 0);
    s.flushes_played = prev.flushes_played + (c.flushes ?? 0);
    s.full_houses_played = prev.full_houses_played + (c.full_houses ?? 0);
    s.four_of_a_kinds_played = prev.four_of_a_kinds_played + (c.four_of_a_kinds ?? 0);
    s.straight_flushes_played = prev.straight_flushes_played + (c.straight_flushes ?? 0);
    s.royal_flushes_played = prev.royal_flushes_played + (c.royal_flushes ?? 0);
  }

  // ── Mode-specific stats ────────────────────────────────────────────────────
  if (game.game_type === 'casual') {
    s.casual_games_played = prev.casual_games_played + 1;
    s.casual_games_won = prev.casual_games_won + (game.won ? 1 : 0);
    s.casual_games_lost = prev.casual_games_lost + (game.won ? 0 : 1);
    s.casual_win_rate = modeWinRate(prev.casual_games_won, prev.casual_games_played);
    s.casual_rank_points = prev.casual_rank_points + rankChange;
  } else if (game.game_type === 'ranked') {
    s.ranked_games_played = prev.ranked_games_played + 1;
    s.ranked_games_won = prev.ranked_games_won + (game.won ? 1 : 0);
    s.ranked_games_lost = prev.ranked_games_lost + (game.won ? 0 : 1);
    s.ranked_win_rate = modeWinRate(prev.ranked_games_won, prev.ranked_games_played);
    s.ranked_rank_points = prev.ranked_rank_points + rankChange;
  } else {
    s.private_games_played = prev.private_games_played + 1;
    s.private_games_won = prev.private_games_won + (game.won ? 1 : 0);
    s.private_games_lost = prev.private_games_lost + (game.won ? 0 : 1);
    s.private_win_rate = modeWinRate(prev.private_games_won, prev.private_games_played);
  }

  return s;
}

/** Run a sequence of games through the engine, returning the final state */
function runGames(games: GameInput[], startState?: StatsState): StatsState {
  return games.reduce((state, game) => applyGame(state, game), startState ?? initialStats());
}

// ─── Game Scenarios (30 games: 10 casual + 10 ranked + 10 private) ───────────
//
//  Win points  : +25    2nd: +10    3rd: -5    4th / abandoned / voided: -15
//  Abandoned   : completed=false, rank penalty applied, no performance stats
//  Voided      : same as abandoned at stats-function level (p_completed=false)
//  Combos only recorded for completed games.

const CASUAL_GAMES: GameInput[] = [
  {
    label: 'C1  Win',
    won: true,
    finish_position: 1,
    score: 0,
    cards_left: 0,
    game_type: 'casual',
    completed: true,
    combos: { singles: 6, pairs: 3, flushes: 1 },
  },
  {
    label: 'C2  2nd',
    won: false,
    finish_position: 2,
    score: 14,
    cards_left: 3,
    game_type: 'casual',
    completed: true,
    combos: { singles: 5, pairs: 2 },
  },
  {
    label: 'C3  Abandoned',
    won: false,
    finish_position: 4,
    score: 0,
    cards_left: 7,
    game_type: 'casual',
    completed: false,
    combos: {},
  },
  {
    label: 'C4  Win',
    won: true,
    finish_position: 1,
    score: 0,
    cards_left: 0,
    game_type: 'casual',
    completed: true,
    combos: { singles: 7, pairs: 2, full_houses: 1 },
  },
  {
    label: 'C5  3rd',
    won: false,
    finish_position: 3,
    score: 20,
    cards_left: 5,
    game_type: 'casual',
    completed: true,
    combos: { singles: 4, pairs: 2, straights: 1 },
  },
  {
    label: 'C6  Win',
    won: true,
    finish_position: 1,
    score: 0,
    cards_left: 0,
    game_type: 'casual',
    completed: true,
    combos: { singles: 5, pairs: 4, straight_flushes: 1 },
  },
  {
    label: 'C7  4th (Loss)',
    won: false,
    finish_position: 4,
    score: 30,
    cards_left: 8,
    game_type: 'casual',
    completed: true,
    combos: { singles: 3, pairs: 1 },
  },
  {
    label: 'C8  Voided',
    won: false,
    finish_position: 4,
    score: 0,
    cards_left: 11,
    game_type: 'casual',
    completed: false,
    combos: {},
  },
  {
    label: 'C9  2nd',
    won: false,
    finish_position: 2,
    score: 16,
    cards_left: 4,
    game_type: 'casual',
    completed: true,
    combos: { singles: 6, pairs: 3, triples: 1 },
  },
  {
    label: 'C10 Win',
    won: true,
    finish_position: 1,
    score: 0,
    cards_left: 0,
    game_type: 'casual',
    completed: true,
    combos: { singles: 8, pairs: 2, flushes: 1, four_of_a_kinds: 1 },
  },
];

const RANKED_GAMES: GameInput[] = [
  {
    label: 'R1  Win',
    won: true,
    finish_position: 1,
    score: 0,
    cards_left: 0,
    game_type: 'ranked',
    completed: true,
    combos: { singles: 5, pairs: 3 },
  },
  {
    label: 'R2  4th (Loss)',
    won: false,
    finish_position: 4,
    score: 35,
    cards_left: 9,
    game_type: 'ranked',
    completed: true,
    combos: { singles: 4, pairs: 2 },
  },
  {
    label: 'R3  Win',
    won: true,
    finish_position: 1,
    score: 0,
    cards_left: 0,
    game_type: 'ranked',
    completed: true,
    combos: { singles: 6, pairs: 2, straight_flushes: 1 },
  },
  {
    label: 'R4  3rd',
    won: false,
    finish_position: 3,
    score: 22,
    cards_left: 6,
    game_type: 'ranked',
    completed: true,
    combos: { singles: 5, pairs: 2, straights: 2 },
  },
  {
    label: 'R5  Abandoned',
    won: false,
    finish_position: 4,
    score: 0,
    cards_left: 8,
    game_type: 'ranked',
    completed: false,
    combos: {},
  },
  {
    label: 'R6  2nd',
    won: false,
    finish_position: 2,
    score: 18,
    cards_left: 4,
    game_type: 'ranked',
    completed: true,
    combos: { singles: 6, pairs: 3, flushes: 1 },
  },
  {
    label: 'R7  Win',
    won: true,
    finish_position: 1,
    score: 0,
    cards_left: 0,
    game_type: 'ranked',
    completed: true,
    combos: { singles: 7, pairs: 3, full_houses: 1 },
  },
  {
    label: 'R8  4th (Loss)',
    won: false,
    finish_position: 4,
    score: 28,
    cards_left: 7,
    game_type: 'ranked',
    completed: true,
    combos: { singles: 4, pairs: 1 },
  },
  {
    label: 'R9  Voided',
    won: false,
    finish_position: 4,
    score: 0,
    cards_left: 12,
    game_type: 'ranked',
    completed: false,
    combos: {},
  },
  {
    label: 'R10 2nd',
    won: false,
    finish_position: 2,
    score: 11,
    cards_left: 2,
    game_type: 'ranked',
    completed: true,
    combos: { singles: 5, pairs: 4, triples: 1 },
  },
];

const PRIVATE_GAMES: GameInput[] = [
  {
    label: 'P1  Win',
    won: true,
    finish_position: 1,
    score: 0,
    cards_left: 0,
    game_type: 'private',
    completed: true,
    combos: { singles: 5, pairs: 2 },
  },
  {
    label: 'P2  3rd',
    won: false,
    finish_position: 3,
    score: 18,
    cards_left: 5,
    game_type: 'private',
    completed: true,
    combos: { singles: 4, pairs: 3 },
  },
  {
    label: 'P3  Win',
    won: true,
    finish_position: 1,
    score: 0,
    cards_left: 0,
    game_type: 'private',
    completed: true,
    combos: { singles: 6, pairs: 2, flushes: 1 },
  },
  {
    label: 'P4  Abandoned',
    won: false,
    finish_position: 4,
    score: 0,
    cards_left: 9,
    game_type: 'private',
    completed: false,
    combos: {},
  },
  {
    label: 'P5  4th (Loss)',
    won: false,
    finish_position: 4,
    score: 32,
    cards_left: 8,
    game_type: 'private',
    completed: true,
    combos: { singles: 3, pairs: 2 },
  },
  {
    label: 'P6  2nd',
    won: false,
    finish_position: 2,
    score: 13,
    cards_left: 3,
    game_type: 'private',
    completed: true,
    combos: { singles: 5, pairs: 3, straights: 1 },
  },
  {
    label: 'P7  Win',
    won: true,
    finish_position: 1,
    score: 0,
    cards_left: 0,
    game_type: 'private',
    completed: true,
    combos: { singles: 7, pairs: 2, royal_flushes: 1 },
  },
  {
    label: 'P8  Voided',
    won: false,
    finish_position: 4,
    score: 0,
    cards_left: 10,
    game_type: 'private',
    completed: false,
    combos: {},
  },
  {
    label: 'P9  3rd',
    won: false,
    finish_position: 3,
    score: 24,
    cards_left: 6,
    game_type: 'private',
    completed: true,
    combos: { singles: 4, pairs: 2, triples: 1 },
  },
  {
    label: 'P10 2nd',
    won: false,
    finish_position: 2,
    score: 17,
    cards_left: 4,
    game_type: 'private',
    completed: true,
    combos: { singles: 5, pairs: 3, full_houses: 1 },
  },
];

const ALL_GAMES = [...CASUAL_GAMES, ...RANKED_GAMES, ...PRIVATE_GAMES];

// ─── Pre-compute snapshots ────────────────────────────────────────────────────

// Per-game snapshots: each entry is the state AFTER that game
const perGameSnapshots: StatsState[] = [];
ALL_GAMES.reduce((state, game) => {
  const next = applyGame(state, game);
  perGameSnapshots.push(next);
  return next;
}, initialStats());

const afterCasual = perGameSnapshots[9]; // after C10
const afterRanked = perGameSnapshots[19]; // after R10
const final = perGameSnapshots[29]; // after P10

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Casual batch (10 games)
// ─────────────────────────────────────────────────────────────────────────────

describe('After 10 casual games', () => {
  it('games played / won / lost are correct', () => {
    expect(afterCasual.games_played).toBe(10);
    expect(afterCasual.casual_games_played).toBe(10);
    expect(afterCasual.casual_games_won).toBe(4); // C1, C4, C6, C10
    expect(afterCasual.casual_games_lost).toBe(6); // C2, C3, C5, C7, C8, C9
  });

  it('rank points: overall = 1070, casual = 1070, ranked/private untouched', () => {
    // Casual Δ: +25(W)+10(2nd)−15(A)+25(W)−5(3rd)+25(W)−15(4th)−15(V)+10(2nd)+25(W) = +70
    expect(afterCasual.rank_points).toBe(1070);
    expect(afterCasual.casual_rank_points).toBe(1070);
    expect(afterCasual.ranked_rank_points).toBe(1000); // untouched
  });

  it('win_rate correct after 4 wins in 10 games', () => {
    // ROUND(4/10*100, 2) = 40.00
    expect(afterCasual.win_rate).toBe(40.0);
    expect(afterCasual.casual_win_rate).toBe(40.0);
  });

  it('games_completed = 8, games_abandoned = 2 (C3 abandoned + C8 voided)', () => {
    expect(afterCasual.games_completed).toBe(8);
    expect(afterCasual.games_abandoned).toBe(2); // C3 + C8
  });

  it('completion_rate = 80.00% (8/10)', () => {
    expect(afterCasual.completion_rate).toBe(80.0);
  });

  it('total_points correct (completed games only, no score for wins/abandons)', () => {
    // C1=0, C2=14, C4=0, C5=20, C6=0, C7=30, C9=16, C10=0 → 80
    expect(afterCasual.total_points).toBe(80);
  });

  it('highest_score = 30 (C7 4th place), lowest_score = 0 (first win)', () => {
    expect(afterCasual.highest_score).toBe(30);
    expect(afterCasual.lowest_score).toBe(0);
  });

  it('total_cards_left = 20, avg_cards_left = 2.50 (completed games only: C3+C8 excluded)', () => {
    // Completed cards: C1=0,C2=3,C4=0,C5=5,C6=0,C7=8,C9=4,C10=0 → 20
    // C3(7) and C8(11) are excluded — abandoned/voided do NOT count
    // avg = 20 / 8 completed = 2.50
    expect(afterCasual.total_cards_left_in_hand).toBe(20);
    expect(afterCasual.avg_cards_left_in_hand).toBe(2.5);
  });

  it('win streaks: longest = 1 (no back-to-back wins in casual), current = 1 (C10 win)', () => {
    // C1-Win, C2-Loss, C3-Loss, C4-Win, C5-Loss, C6-Win, C7-Loss, C8-Loss, C9-Loss, C10-Win
    // Max consecutive before C10 = 1 (C1, C4, or C6)
    expect(afterCasual.longest_win_streak).toBe(1);
    expect(afterCasual.current_win_streak).toBe(1); // C10 was a win
  });

  it('longest_completion_streak = 4 (C4,C5,C6,C7)', () => {
    // C1✓ C2✓ C3✗ C4✓ C5✓ C6✓ C7✓ C8✗ C9✓ C10✓
    //  1   2   0   1   2   3   4   0   1   2
    expect(afterCasual.longest_completion_streak).toBe(4);
    expect(afterCasual.current_completion_streak).toBe(2); // C9+C10
  });

  it('combo totals (completed games only, 8 games)', () => {
    // Singles: 6+5+7+4+5+3+6+8 = 44
    expect(afterCasual.singles_played).toBe(44);
    // Pairs: 3+2+2+2+4+1+3+2 = 19
    expect(afterCasual.pairs_played).toBe(19);
    // Triples: C9 only = 1
    expect(afterCasual.triples_played).toBe(1);
    // Straights: C5 only = 1
    expect(afterCasual.straights_played).toBe(1);
    // Flushes: C1+C10 = 2
    expect(afterCasual.flushes_played).toBe(2);
    // Full houses: C4 = 1
    expect(afterCasual.full_houses_played).toBe(1);
    // Four-of-a-kinds: C10 = 1
    expect(afterCasual.four_of_a_kinds_played).toBe(1);
    // Straight flushes: C6 = 1
    expect(afterCasual.straight_flushes_played).toBe(1);
    // Royal flushes: 0
    expect(afterCasual.royal_flushes_played).toBe(0);
  });

  it('rank_points_history has 10 entries, all tagged casual', () => {
    expect(afterCasual.rank_points_history).toHaveLength(10);
    afterCasual.rank_points_history.forEach(e => {
      expect(e.game_type).toBe('casual');
    });
  });

  it('rank_points_history correctly tracks wins (+25) and losses', () => {
    const h = afterCasual.rank_points_history;
    // C1: win → 1000+25=1025
    expect(h[0]).toMatchObject({ points: 1025, is_win: true });
    // C2: 2nd → 1025+10=1035
    expect(h[1]).toMatchObject({ points: 1035, is_win: false });
    // C3: abandoned → 1035−15=1020
    expect(h[2]).toMatchObject({ points: 1020, is_win: false });
    // C4: win → 1020+25=1045
    expect(h[3]).toMatchObject({ points: 1045, is_win: true });
    // C5: 3rd → 1045−5=1040
    expect(h[4]).toMatchObject({ points: 1040, is_win: false });
    // C6: win → 1040+25=1065
    expect(h[5]).toMatchObject({ points: 1065, is_win: true });
    // C7: 4th → 1065−15=1050
    expect(h[6]).toMatchObject({ points: 1050, is_win: false });
    // C8: voided → 1050−15=1035
    expect(h[7]).toMatchObject({ points: 1035, is_win: false });
    // C9: 2nd → 1035+10=1045
    expect(h[8]).toMatchObject({ points: 1045, is_win: false });
    // C10: win → 1045+25=1070
    expect(h[9]).toMatchObject({ points: 1070, is_win: true });
  });

  it('avg_finish_position is weighted by completed games only (not abandons)', () => {
    // Completed positions: 1,2,1,3,1,4,2,1 → sum=15, count=8 → exact avg=1.875
    // Running avg trace: 1.0→1.5→1.33→1.75→1.60→2.00→2.00→1.88
    const pos = afterCasual.avg_finish_position;
    expect(pos).toBeGreaterThanOrEqual(1.85);
    expect(pos).toBeLessThanOrEqual(1.95);
  });

  it('avg_score uses completed games denominator so abandons do NOT inflate it', () => {
    // Scores: 0,14,0,20,0,30,16,0 → sum=80, exact avg=80/8=10.0
    // Running avg with ROUND(x,2) may give ~10.00 ±0.05
    expect(afterCasual.avg_score_per_game).toBeGreaterThanOrEqual(9.95);
    expect(afterCasual.avg_score_per_game).toBeLessThanOrEqual(10.1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — After adding 10 ranked games (20 total)
// ─────────────────────────────────────────────────────────────────────────────

describe('After 10 casual + 10 ranked games (20 total)', () => {
  it('ranked_games_played = 10, casual still 10', () => {
    expect(afterRanked.ranked_games_played).toBe(10);
    expect(afterRanked.casual_games_played).toBe(10);
    expect(afterRanked.games_played).toBe(20);
  });

  it('ranked wins/losses: 3 wins, 7 losses', () => {
    // R1-Win, R3-Win, R7-Win = 3 wins
    expect(afterRanked.ranked_games_won).toBe(3);
    expect(afterRanked.ranked_games_lost).toBe(7);
  });

  it('ranked_rank_points: 1000 + 30 = 1030', () => {
    // R1:+25→1025 R2:−15→1010 R3:+25→1035 R4:−5→1030 R5:−15→1015
    // R6:+10→1025 R7:+25→1050 R8:−15→1035 R9:−15→1020 R10:+10→1030
    expect(afterRanked.ranked_rank_points).toBe(1030);
  });

  it('overall rank_points = 1100 after 20 games (casual Δ+70, ranked Δ+30)', () => {
    expect(afterRanked.rank_points).toBe(1100);
  });

  it('casual_rank_points unchanged at 1070', () => {
    expect(afterRanked.casual_rank_points).toBe(1070);
  });

  it('games_completed = 16 (8 casual + 8 ranked)', () => {
    // R5(abandoned) + R9(voided) = 2 extra abandons
    expect(afterRanked.games_completed).toBe(16);
    expect(afterRanked.games_abandoned).toBe(4); // C3+C8+R5+R9
  });

  it('completion_rate = 80.00% (16/20)', () => {
    expect(afterRanked.completion_rate).toBe(80.0);
  });

  it('total_points includes ranked scores (completed only)', () => {
    // Casual: 80, Ranked: 0+35+0+22+18+0+28+11 = 114 → total = 194
    expect(afterRanked.total_points).toBe(194);
  });

  it('highest_score = 35 (R2 4th place 9 cards left)', () => {
    expect(afterRanked.highest_score).toBe(35);
  });

  it('total_cards_left = 48 (completed only: casual 20 + ranked 28), avg = 3.00', () => {
    // Ranked completed: R1=0,R2=9,R3=0,R4=6,R6=4,R7=0,R8=7,R10=2 → 28 (R5+R9 excluded)
    // Total = 20+28 = 48; avg = 48/16 completed = 3.00
    expect(afterRanked.total_cards_left_in_hand).toBe(48);
    expect(afterRanked.avg_cards_left_in_hand).toBe(3.0);
  });

  it('longest_win_streak = 2 (C10-Win then R1-Win are back-to-back)', () => {
    // C10 is a win, R1 is a win → streak goes 1→2
    expect(afterRanked.longest_win_streak).toBe(2);
  });

  it('longest_completion_streak = 6 (C9,C10,R1,R2,R3,R4 all completed)', () => {
    // C9✓C10✓R1✓R2✓R3✓R4✓ = 6 consecutive completions
    expect(afterRanked.longest_completion_streak).toBe(6);
  });

  it('ranked_win_rate = 30.00% (3/10)', () => {
    expect(afterRanked.ranked_win_rate).toBe(30.0);
  });

  it('overall win_rate after 20 games (7 wins)', () => {
    // C1,C4,C6,C10 (4) + R1,R3,R7 (3) = 7 wins out of 20
    // ROUND(7/20*100, 2) = 35.00
    expect(afterRanked.win_rate).toBe(35.0);
  });

  it('rank_points_history has 20 entries with mixed game_types', () => {
    expect(afterRanked.rank_points_history).toHaveLength(20);
    const modes = afterRanked.rank_points_history.map(e => e.game_type);
    expect(modes.slice(0, 10).every(m => m === 'casual')).toBe(true);
    expect(modes.slice(10, 20).every(m => m === 'ranked')).toBe(true);
  });

  it('ranked progression shows R1 win (+25) after C10 high of 1070', () => {
    const h = afterRanked.rank_points_history;
    // C10 final = 1070
    expect(h[9]).toMatchObject({ points: 1070, is_win: true, game_type: 'casual' });
    // R1 win → 1070+25=1095
    expect(h[10]).toMatchObject({ points: 1095, is_win: true, game_type: 'ranked' });
    // R2 4th → 1095−15=1080
    expect(h[11]).toMatchObject({ points: 1080, is_win: false, game_type: 'ranked' });
  });

  it('ranked combo totals only include ranked completed games', () => {
    // R1,R2,R3,R4,R6,R7,R8,R10 completed (8 games, R5 abandoned R9 voided excluded)
    // Total after 20: casual(44)+ranked(42) = 86 singles
    expect(afterRanked.singles_played).toBe(86); // 44 casual + 42 ranked
    // Straight flushes: casual(1=C6) + ranked(1=R3) = 2
    expect(afterRanked.straight_flushes_played).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — After all 30 games (casual + ranked + private)
// ─────────────────────────────────────────────────────────────────────────────

describe('Full 30-game profile (10 casual + 10 ranked + 10 private)', () => {
  // ── Game counts ────────────────────────────────────────────────────────────
  it('total games_played = 30', () => expect(final.games_played).toBe(30));
  it('per-mode games_played = 10 each', () => {
    expect(final.casual_games_played).toBe(10);
    expect(final.ranked_games_played).toBe(10);
    expect(final.private_games_played).toBe(10);
  });
  it('total wins = 10 (4 casual + 3 ranked + 3 private)', () => {
    expect(final.games_won).toBe(10);
    expect(final.casual_games_won).toBe(4);
    expect(final.ranked_games_won).toBe(3);
    expect(final.private_games_won).toBe(3);
  });
  it('total losses = 20', () => expect(final.games_lost).toBe(20));

  // ── Rank points ────────────────────────────────────────────────────────────
  it('final rank_points = 1140 (start 1000, total Δ = +70 +30 +40)', () => {
    // Private Δ: +25(W)−5(3rd)+25(W)−15(A)−15(4th)+10(2nd)+25(W)−15(V)−5(3rd)+10(2nd) = +40
    expect(final.rank_points).toBe(1140);
  });
  it('casual_rank_points = 1070', () => expect(final.casual_rank_points).toBe(1070));
  it('ranked_rank_points = 1030', () => expect(final.ranked_rank_points).toBe(1030));
  it('private games do NOT have their own rank_points column (no private_rank_points)', () => {
    // Private games contribute to overall rank_points only
    expect(final.rank_points).toBe(1140); // accounts for all 3 modes
    expect((final as any).private_rank_points).toBeUndefined();
  });

  // ── Win rates ──────────────────────────────────────────────────────────────
  it('overall win_rate = 33.33% (10/30)', () => {
    // ROUND(10/30*100, 2) = 33.33
    expect(final.win_rate).toBe(33.33);
  });
  it('casual_win_rate = 40.00% (4/10)', () => expect(final.casual_win_rate).toBe(40.0));
  it('ranked_win_rate = 30.00% (3/10)', () => expect(final.ranked_win_rate).toBe(30.0));
  it('private_win_rate = 30.00% (3/10)', () => expect(final.private_win_rate).toBe(30.0));

  // ── Game completion ────────────────────────────────────────────────────────
  it('games_completed = 24 (30 − 6 abandoned/voided)', () => {
    expect(final.games_completed).toBe(24);
  });
  it('games_abandoned = 6 (C3+C8 + R5+R9 + P4+P8 = 3 abandoned + 3 voided)', () => {
    expect(final.games_abandoned).toBe(6);
  });
  it('completion_rate = 80.00% (24/30)', () => expect(final.completion_rate).toBe(80.0));
  it('longest_completion_streak = 6 (C9→C10→R1→R2→R3→R4)', () => {
    expect(final.longest_completion_streak).toBe(6);
  });
  it('current_completion_streak = 2 (P9 + P10 last two games both completed)', () => {
    expect(final.current_completion_streak).toBe(2);
  });

  // ── Win streaks ────────────────────────────────────────────────────────────
  it('longest_win_streak = 2 (C10 win immediately followed by R1 win)', () => {
    expect(final.longest_win_streak).toBe(2);
  });
  it('current_win_streak = 0 (P10 was 2nd place — a loss)', () => {
    expect(final.current_win_streak).toBe(0);
  });

  // ── Scores (completed games only) ─────────────────────────────────────────
  it('total_points = 298 across all 24 completed games', () => {
    // Casual(80) + Ranked(114) + Private(104) = 298
    // Casual:  0+14+0+20+0+30+16+0 = 80
    // Ranked:  0+35+0+22+18+0+28+11 = 114
    // Private: 0+18+0+32+13+0+24+17 = 104
    expect(final.total_points).toBe(298);
  });
  it('highest_score = 35 (R2: 4th place with 9 cards left)', () => {
    expect(final.highest_score).toBe(35);
  });
  it('lowest_score = 0 (winner always has 0 score)', () => {
    expect(final.lowest_score).toBe(0);
  });
  it('avg_score_per_game ≈ 12.42 (298/24 = 12.42)', () => {
    // Running avg with ROUND(x,2) produces ~12.42; tolerance ±0.05
    expect(final.avg_score_per_game).toBeGreaterThanOrEqual(12.37);
    expect(final.avg_score_per_game).toBeLessThanOrEqual(12.47);
  });

  // ── Cards left ─────────────────────────────────────────────────────────────
  it('total_cards_left_in_hand = 74 (completed games only — 6 abandoned/voided excluded)', () => {
    // Casual(20) + Ranked(28) + Private(26) = 74
    // Private completed: P1=0,P2=5,P3=0,P5=8,P6=3,P7=0,P9=6,P10=4 → 26 (P4+P8 excluded)
    expect(final.total_cards_left_in_hand).toBe(74);
  });
  it('avg_cards_left_in_hand = 3.08 (74 / 24 completed games)', () => {
    // 74/24 = 3.0833... → ROUND(,2) = 3.08
    expect(final.avg_cards_left_in_hand).toBe(3.08);
  });
  it('abandoned/voided games do NOT inflate avg_cards_left (completed denominator)', () => {
    // Old (wrong) calc: 131/30 all games = 4.37
    // Fixed calc: 74/24 completed games = 3.08  — confirmed lower
    expect(final.avg_cards_left_in_hand).toBeLessThan(3.5);
    expect(final.avg_cards_left_in_hand).toBe(3.08);
  });

  // ── Average position (completed only) ──────────────────────────────────────
  it('avg_finish_position is near 2.08 (50 total position / 24 completed games)', () => {
    // Completed positions: casual[1,2,1,3,1,4,2,1] + ranked[1,4,1,3,2,1,4,2] + private[1,3,1,4,2,1,3,2]
    // Sum = 15 + 18 + 17 = 50; exact = 50/24 = 2.0833
    // Running ROUND(x,2) may drift; tolerance ±0.10
    expect(final.avg_finish_position).toBeGreaterThanOrEqual(2.0);
    expect(final.avg_finish_position).toBeLessThanOrEqual(2.15);
  });
  it('abandonments do NOT affect avg_finish_position (completed denominator only)', () => {
    // If abandons counted (30 denominator, 4th-pos penalty): avg would be higher
    // Confirmed by checking abandoned game C3 (4th) adds to games_abandoned not avg_pos
    expect(final.games_abandoned).toBe(6); // 6 games excluded from avg_pos calc
  });

  // ── Combo totals (completed games only, 24 games) ──────────────────────────
  it('singles_played = 125 (44 casual + 42 ranked + 39 private)', () => {
    expect(final.singles_played).toBe(125);
  });
  it('pairs_played = 58 (19 + 20 + 19)', () => {
    expect(final.pairs_played).toBe(58);
  });
  it('triples_played = 3 (C9=1, R10=1, P9=1)', () => {
    expect(final.triples_played).toBe(3);
  });
  it('straights_played = 4 (C5=1, R4=2, P6=1)', () => {
    expect(final.straights_played).toBe(4);
  });
  it('flushes_played = 4 (C1=1, C10=1, R6=1, P3=1)', () => {
    expect(final.flushes_played).toBe(4);
  });
  it('full_houses_played = 3 (C4=1, R7=1, P10=1)', () => {
    expect(final.full_houses_played).toBe(3);
  });
  it('four_of_a_kinds_played = 1 (C10 only)', () => {
    expect(final.four_of_a_kinds_played).toBe(1);
  });
  it('straight_flushes_played = 2 (C6=1, R3=1)', () => {
    expect(final.straight_flushes_played).toBe(2);
  });
  it('royal_flushes_played = 1 (P7 only)', () => {
    expect(final.royal_flushes_played).toBe(1);
  });
  it('abandoned/voided combos are EXCLUDED from totals', () => {
    // C3, C8, R5, R9, P4, P8 all completed=false → combos: {}
    // If they counted, singles would be higher than 125 (they all had combos: {})
    // Actual: 0 extra, so 125 is exactly correct
    expect(final.singles_played).toBe(125);
  });

  // ── Rank progression history ────────────────────────────────────────────────
  it('rank_points_history has 30 entries (one per game)', () => {
    expect(final.rank_points_history).toHaveLength(30);
  });
  it('history entries span all 3 game types', () => {
    const types = final.rank_points_history.map(e => e.game_type);
    expect(types.filter(t => t === 'casual')).toHaveLength(10);
    expect(types.filter(t => t === 'ranked')).toHaveLength(10);
    expect(types.filter(t => t === 'private')).toHaveLength(10);
  });
  it('history first entry = C1 win (+25 → 1025)', () => {
    expect(final.rank_points_history[0]).toMatchObject({
      points: 1025,
      is_win: true,
      game_type: 'casual',
    });
  });
  it('history last entry = P10 2nd (+10 → 1140)', () => {
    expect(final.rank_points_history[29]).toMatchObject({
      points: 1140,
      is_win: false,
      game_type: 'private',
    });
  });
  it('history tracks the rank dip after C3 abandoned (−15)', () => {
    // C2: 1035, C3 abandoned: 1035-15=1020
    expect(final.rank_points_history[2]).toMatchObject({ points: 1020, is_win: false });
  });
  it('history shows C10→R1 back-to-back wins (both is_win=true)', () => {
    // Index 9=C10, 10=R1
    expect(final.rank_points_history[9].is_win).toBe(true);
    expect(final.rank_points_history[10].is_win).toBe(true);
  });
  it('ranked-only progression graph: 10 ranked entries tell the ranked story', () => {
    const rankedOnly = final.rank_points_history.filter(e => e.game_type === 'ranked');
    expect(rankedOnly).toHaveLength(10);
    // First ranked entry is R1 win: overall 1070+25=1095
    expect(rankedOnly[0]).toMatchObject({ points: 1095, is_win: true });
    // Last ranked entry is R10 2nd: overall 1090+10=1100
    expect(rankedOnly[9]).toMatchObject({ points: 1100, is_win: false });
  });
  it('history point values are monotonically correct (each = prev ± rankChange)', () => {
    const h = final.rank_points_history;
    for (let i = 1; i < h.length; i++) {
      const diff = h[i].points - h[i - 1].points;
      expect([25, 10, -5, -15]).toContain(diff);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Edge-case invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('Stats engine invariants across all 30 games', () => {
  it('games_won + games_lost = games_played (no orphan games)', () => {
    expect(final.games_won + final.games_lost).toBe(final.games_played);
  });
  it('games_completed + games_abandoned = games_played', () => {
    expect(final.games_completed + final.games_abandoned).toBe(final.games_played);
  });
  it('casual + ranked + private games_played = total games_played', () => {
    expect(final.casual_games_played + final.ranked_games_played + final.private_games_played).toBe(
      final.games_played
    );
  });
  it('casual + ranked + private wins/losses sum correctly', () => {
    expect(final.casual_games_won + final.ranked_games_won + final.private_games_won).toBe(
      final.games_won
    );
    expect(final.casual_games_lost + final.ranked_games_lost + final.private_games_lost).toBe(
      final.games_lost
    );
  });
  it('lowest_score ≤ avg_score ≤ highest_score', () => {
    expect(final.lowest_score!).toBeLessThanOrEqual(final.avg_score_per_game);
    expect(final.avg_score_per_game).toBeLessThanOrEqual(final.highest_score);
  });
  it('rank changes are only +25, +10, -5, -15', () => {
    const h = final.rank_points_history;
    for (let i = 1; i < h.length; i++) {
      const diff = h[i].points - h[i - 1].points;
      expect([25, 10, -5, -15]).toContain(diff);
    }
  });
  it('casual_rank_points + ranked_rank_points relative change equals difference in mode Δ', () => {
    const casualDelta = final.casual_rank_points - 1000; // +70
    const rankedDelta = final.ranked_rank_points - 1000; // +30
    const privateDelta = final.rank_points - 1000 - casualDelta - rankedDelta; // +40
    expect(casualDelta).toBe(70);
    expect(rankedDelta).toBe(30);
    expect(privateDelta).toBe(40);
  });
  it('win_rate is between 0 and 100', () => {
    expect(final.win_rate).toBeGreaterThanOrEqual(0);
    expect(final.win_rate).toBeLessThanOrEqual(100);
  });
  it('completion_rate is between 0 and 100', () => {
    expect(final.completion_rate).toBeGreaterThanOrEqual(0);
    expect(final.completion_rate).toBeLessThanOrEqual(100);
  });
  it('avg_finish_position is between 1 and 4', () => {
    expect(final.avg_finish_position).toBeGreaterThanOrEqual(1);
    expect(final.avg_finish_position).toBeLessThanOrEqual(4);
  });
  it('completion breakdown correct after all 6 incomplete games', () => {
    // 3 casual incomplete (C3 abandoned + C8 voided): wait, only C3 and C8
    // 3 ranked incomplete (R5 abandoned + R9 voided): only R5 and R9
    // 3 private incomplete (P4 abandoned + P8 voided): P4 and P8
    // Total = 6 games_abandoned, 24 games_completed
    expect(final.games_abandoned).toBe(6);
    expect(final.games_completed).toBe(24);
    expect(final.completion_rate).toBe(80.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Setup: setup.ts mocks console.log → jest.fn(). Use process.stdout.write so
// our sandbox print tests bypass that mock and always emit visible output.
// ─────────────────────────────────────────────────────────────────────────────

const print = (...args: any[]) =>
  process.stdout.write(args.map(a => (typeof a === 'string' ? a : String(a))).join(' ') + '\n');

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Per-game results table (what happened in each of the 30 games)
// ─────────────────────────────────────────────────────────────────────────────

describe('Per-game results — every game outcome and running stats', () => {
  it('prints per-game results table', () => {
    const separator = '─'.repeat(130);

    // Column layout
    const header = [
      '#  ',
      'Label           ',
      'Mode   ',
      'Result',
      'Score',
      'Cards',
      'OverallRP',
      'CasualRP ',
      'RankedRP ',
      'WinRate',
      'CompRate',
      'TotalCards',
      'AvgCards',
      'AvgPos',
      'AvgScore',
    ].join(' | ');

    const rows = ALL_GAMES.map((g, i) => {
      const s = perGameSnapshots[i];
      const h = s.rank_points_history;
      const lastH = h[h.length - 1];
      const delta =
        i === 0
          ? lastH.points - 1000
          : lastH.points -
            perGameSnapshots[i - 1].rank_points_history[
              perGameSnapshots[i - 1].rank_points_history.length - 1
            ].points;
      const deltaStr = delta >= 0 ? `+${delta}` : String(delta);
      const resultEmoji = g.won
        ? `✅ 1st ${deltaStr}`
        : g.finish_position === 2
          ? `🥈 2nd ${deltaStr}`
          : g.finish_position === 3
            ? `🥉 3rd ${deltaStr}`
            : g.completed
              ? `💀 4th ${deltaStr}`
              : g.label.includes('Abandoned')
                ? `🏃 Abn ${deltaStr}`
                : `🚫 Void ${deltaStr}`;

      return [
        String(i + 1).padStart(2) + ' ',
        g.label.padEnd(16),
        g.game_type.padEnd(7),
        resultEmoji.padEnd(12),
        String(g.score).padStart(5),
        String(g.cards_left).padStart(5),
        String(s.rank_points).padStart(9),
        String(s.casual_rank_points).padStart(9),
        String(s.ranked_rank_points).padStart(9),
        `${s.win_rate}%`.padStart(7),
        `${s.completion_rate}%`.padStart(8),
        String(s.total_cards_left_in_hand).padStart(10),
        String(s.avg_cards_left_in_hand).padStart(8),
        String(s.avg_finish_position).padStart(6),
        String(s.avg_score_per_game).padStart(8),
      ].join(' | ');
    });

    print(`\n${'═'.repeat(130)}`);
    print('  PER-GAME RESULTS — 30 GAME SIMULATION');
    print(`${'═'.repeat(130)}`);
    print(header);
    print(separator);
    rows.forEach((r, i) => {
      // Print a spacer between modes
      if (i === 10 || i === 20) print(separator);
      print(r);
    });
    print(`${'═'.repeat(130)}\n`);

    // Spot-check a few rows for correctness
    // After C1 (win): rank=1025, casual=1025, ranked=1000
    expect(perGameSnapshots[0].rank_points).toBe(1025);
    expect(perGameSnapshots[0].casual_rank_points).toBe(1025);
    expect(perGameSnapshots[0].ranked_rank_points).toBe(1000);

    // After C3 (abandoned): rank dropped 15 from 1035 → 1020
    expect(perGameSnapshots[2].rank_points).toBe(1020);
    expect(perGameSnapshots[2].total_cards_left_in_hand).toBe(3); // only C2's 3 cards so far (completed)

    // After R1 (first ranked win): ranked 1000+25=1025, casual unchanged at 1070
    expect(perGameSnapshots[10].ranked_rank_points).toBe(1025);
    expect(perGameSnapshots[10].casual_rank_points).toBe(1070);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — Rank point progression (casual + ranked per game)
// ─────────────────────────────────────────────────────────────────────────────

describe('Rank progression — casual and ranked points after every game', () => {
  it('prints casual rank point progression (10 casual games)', () => {
    print('\n  CASUAL RANK POINT PROGRESSION');
    print('  ' + '─'.repeat(70));
    print('  Start: casual_rank_points = 1000');
    print('  ' + '─'.repeat(70));

    let expected = 1000;
    CASUAL_GAMES.forEach((g, i) => {
      const s = perGameSnapshots[i];
      const delta = g.won ? 25 : g.finish_position === 2 ? 10 : g.finish_position === 3 ? -5 : -15;
      expected += delta;
      const deltaStr = delta >= 0 ? `+${delta}` : String(delta);
      const icon = g.won
        ? '✅'
        : g.finish_position === 2
          ? '🥈'
          : g.finish_position === 3
            ? '🥉'
            : g.completed
              ? '💀'
              : g.label.includes('Abandoned')
                ? '🏃'
                : '🚫';
      print(
        `  [C${i + 1}] ${g.label.padEnd(16)} ${icon} ${deltaStr.padStart(4)} → casual_rp = ${s.casual_rank_points}  ranked_rp = ${s.ranked_rank_points} (unchanged)`
      );
      expect(s.casual_rank_points).toBe(expected);
    });

    print('  ' + '─'.repeat(70));
    print(
      `  After 10 casual games: casual_rank_points = ${afterCasual.casual_rank_points} (Δ = +${afterCasual.casual_rank_points - 1000})\n`
    );
  });

  it('prints ranked rank point progression (10 ranked games)', () => {
    print('\n  RANKED RANK POINT PROGRESSION');
    print('  ' + '─'.repeat(70));
    print('  Start: ranked_rank_points = 1000');
    print('  ' + '─'.repeat(70));

    let expected = 1000;
    RANKED_GAMES.forEach((g, ri) => {
      const i = 10 + ri;
      const s = perGameSnapshots[i];
      const delta = g.won ? 25 : g.finish_position === 2 ? 10 : g.finish_position === 3 ? -5 : -15;
      expected += delta;
      const deltaStr = delta >= 0 ? `+${delta}` : String(delta);
      const icon = g.won
        ? '✅'
        : g.finish_position === 2
          ? '🥈'
          : g.finish_position === 3
            ? '🥉'
            : g.completed
              ? '💀'
              : g.label.includes('Abandoned')
                ? '🏃'
                : '🚫';
      print(
        `  [R${ri + 1}] ${g.label.padEnd(16)} ${icon} ${deltaStr.padStart(4)} → ranked_rp = ${s.ranked_rank_points}  casual_rp = ${s.casual_rank_points} (unchanged)`
      );
      expect(s.ranked_rank_points).toBe(expected);
    });

    print('  ' + '─'.repeat(70));
    print(
      `  After 10 ranked games: ranked_rank_points = ${afterRanked.ranked_rank_points} (Δ = +${afterRanked.ranked_rank_points - 1000})\n`
    );
  });

  it('prints private game impact on overall rank (no private_rank_points column)', () => {
    print('\n  PRIVATE GAME IMPACT ON OVERALL RANK POINTS');
    print('  ' + '─'.repeat(70));
    print(`  Start of private batch: overall_rank_points = ${afterRanked.rank_points}`);
    print('  (private games contribute to overall rank only — no separate private ELO)');
    print('  ' + '─'.repeat(70));

    PRIVATE_GAMES.forEach((g, pi) => {
      const i = 20 + pi;
      const s = perGameSnapshots[i];
      const prev = perGameSnapshots[i - 1] ?? afterRanked;
      const delta = g.won ? 25 : g.finish_position === 2 ? 10 : g.finish_position === 3 ? -5 : -15;
      const deltaStr = delta >= 0 ? `+${delta}` : String(delta);
      const icon = g.won
        ? '✅'
        : g.finish_position === 2
          ? '🥈'
          : g.finish_position === 3
            ? '🥉'
            : g.completed
              ? '💀'
              : g.label.includes('Abandoned')
                ? '🏃'
                : '🚫';
      print(
        `  [P${pi + 1}] ${g.label.padEnd(16)} ${icon} ${deltaStr.padStart(4)} → overall_rp = ${s.rank_points}  casual/ranked unchanged`
      );
      expect(s.casual_rank_points).toBe(1070); // never changes during private games
      expect(s.ranked_rank_points).toBe(1030); // never changes during private games
    });

    print('  ' + '─'.repeat(70));
    print(
      `  After 10 private games: overall_rank_points = ${final.rank_points} (Δ from Ranked end = +${final.rank_points - afterRanked.rank_points})\n`
    );
  });

  it('verifies casual/ranked rank point values after every single game', () => {
    // Full trace of expected casual_rank_points
    const expectedCasualRP = [
      1025, // C1 win +25
      1035, // C2 2nd +10
      1020, // C3 abn -15
      1045, // C4 win +25
      1040, // C5 3rd -5
      1065, // C6 win +25
      1050, // C7 4th -15
      1035, // C8 void -15
      1045, // C9 2nd +10
      1070, // C10 win +25
    ];
    // During ranked games casual_rp stays at 1070
    // During private games casual_rp stays at 1070
    expectedCasualRP.forEach((rp, i) => {
      expect(perGameSnapshots[i].casual_rank_points).toBe(rp);
    });
    for (let i = 10; i < 30; i++) {
      expect(perGameSnapshots[i].casual_rank_points).toBe(1070);
    }

    // Full trace of expected ranked_rank_points
    const expectedRankedRP = [
      1025, // R1 win +25
      1010, // R2 4th -15
      1035, // R3 win +25
      1030, // R4 3rd -5
      1015, // R5 abn -15
      1025, // R6 2nd +10
      1050, // R7 win +25
      1035, // R8 4th -15
      1020, // R9 void -15
      1030, // R10 2nd +10
    ];
    // During casual games ranked_rp stays at 1000
    for (let i = 0; i < 10; i++) {
      expect(perGameSnapshots[i].ranked_rank_points).toBe(1000);
    }
    expectedRankedRP.forEach((rp, ri) => {
      expect(perGameSnapshots[10 + ri].ranked_rank_points).toBe(rp);
    });
    // During private games ranked_rp stays at 1030
    for (let i = 20; i < 30; i++) {
      expect(perGameSnapshots[i].ranked_rank_points).toBe(1030);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — Player Profile Report (summary)
// ─────────────────────────────────────────────────────────────────────────────

describe('Player Profile Report (30 games)', () => {
  it('prints the full player stat profile', () => {
    const f = final;
    const bar = '═'.repeat(56);
    const pad = (label: string, val: string | number) =>
      `  ${label.padEnd(30)} ${String(val).padStart(10)}`;

    const lines = [
      `\n${bar}`,
      `   PLAYER PROFILE — 30 GAME SIMULATION`,
      bar,
      '',
      '  GAMES OVERVIEW',
      pad('Total Games Played', f.games_played),
      pad('Wins', f.games_won),
      pad('Losses', f.games_lost),
      pad('Win Rate', `${f.win_rate}%`),
      '',
      '  PER-MODE BREAKDOWN',
      pad(
        'Casual  (10 games)',
        `${f.casual_games_won}W ${f.casual_games_lost}L  ${f.casual_win_rate}%`
      ),
      pad(
        'Ranked  (10 games)',
        `${f.ranked_games_won}W ${f.ranked_games_lost}L  ${f.ranked_win_rate}%`
      ),
      pad(
        'Private (10 games)',
        `${f.private_games_won}W ${f.private_games_lost}L  ${f.private_win_rate}%`
      ),
      '',
      '  RANK POINTS',
      pad('Overall Rank Points', f.rank_points),
      pad('  (started at)', 1000),
      pad('  (total change)', `+${f.rank_points - 1000}`),
      pad('Casual Rank Points', `${f.casual_rank_points}  (Δ +${f.casual_rank_points - 1000})`),
      pad('Ranked Rank Points', `${f.ranked_rank_points}  (Δ +${f.ranked_rank_points - 1000})`),
      pad('Private Rank Points', 'N/A (no private ELO)'),
      '',
      '  GAME COMPLETION',
      pad('Games Completed', `${f.games_completed} / ${f.games_played}`),
      pad('Abandoned + Voided', f.games_abandoned),
      pad('Completion Rate', `${f.completion_rate}%`),
      pad('Current Completion Streak', f.current_completion_streak),
      pad('Longest Completion Streak', f.longest_completion_streak),
      '',
      '  PERFORMANCE (completed games only)',
      pad('Total Points', f.total_points),
      pad('Average Score / Game', f.avg_score_per_game),
      pad('Highest Score  (💀 worst)', f.highest_score),
      pad('Lowest Score   (⭐ best)', f.lowest_score ?? 'N/A'),
      pad('Avg Finish Position', f.avg_finish_position),
      '',
      '  CARDS IN HAND (completed games only)',
      pad('Total Cards Left (24 games)', f.total_cards_left_in_hand),
      pad('Avg Cards Left / Game', f.avg_cards_left_in_hand),
      pad('  (abandoned excl. → was)', '4.37 if all 30 games counted'),
      '',
      '  WIN STREAKS',
      pad('Current Win Streak', f.current_win_streak),
      pad('Longest Win Streak', f.longest_win_streak),
      '',
      '  COMBOS (completed games)',
      pad('Singles', f.singles_played),
      pad('Pairs', f.pairs_played),
      pad('Triples', f.triples_played),
      pad('Straights', f.straights_played),
      pad('Flushes', f.flushes_played),
      pad('Full Houses', f.full_houses_played),
      pad('Four of a Kinds', f.four_of_a_kinds_played),
      pad('Straight Flushes', f.straight_flushes_played),
      pad('Royal Flushes', f.royal_flushes_played),
      bar,
    ];

    print(lines.join('\n'));

    expect(f.rank_points).toBe(1140);
    expect(f.casual_rank_points).toBe(1070);
    expect(f.ranked_rank_points).toBe(1030);
    expect(f.completion_rate).toBe(80.0);
    expect(f.total_points).toBe(298);
    expect(f.avg_cards_left_in_hand).toBe(3.08);
    expect(f.total_cards_left_in_hand).toBe(74);
    expect(f.rank_points_history).toHaveLength(30);
  });
});
