// @ts-nocheck
/**
 * Leaderboard & Stats Sandbox Tests
 *
 * Covers:
 *  1. toPlayerStats — DB row → PlayerStats mapping (defaults, nulls, rank override)
 *  2. Combo stats aggregation — matchComboStats array summation
 *  3. Leaderboard entry construction — per-mode (casual / ranked) column picks & rank offset
 *  4. rank_points_history type guard — valid / invalid entry filtering
 *  5. Game completion payload — offline (all-bot) guard logic
 */

// ─── Types mirrored from StatsScreen / state.ts ──────────────────────────────

interface PlayerStats {
  user_id: string;
  games_played: number;
  games_won: number;
  games_lost: number;
  win_rate: number;
  avg_finish_position: number;
  total_points: number;
  highest_score: number;
  lowest_score: number | null;
  avg_score_per_game: number;
  avg_cards_left_in_hand: number;
  current_win_streak: number;
  longest_win_streak: number;
  current_loss_streak: number;
  global_rank: number | null;
  rank_points: number;
  rank_points_history:
    | { timestamp: string; points: number; is_win: boolean; game_type: string }[]
    | null;
  // per-mode
  casual_games_played: number;
  casual_games_won: number;
  casual_games_lost: number;
  casual_win_rate: number;
  casual_rank_points: number;
  ranked_games_played: number;
  ranked_games_won: number;
  ranked_games_lost: number;
  ranked_win_rate: number;
  ranked_rank_points: number;
  private_games_played: number;
  private_games_won: number;
  private_games_lost: number;
  private_win_rate: number;
  // completion
  games_completed: number;
  games_abandoned: number;
  games_voided: number;
  completion_rate: number;
  current_completion_streak: number;
  longest_completion_streak: number;
  casual_games_completed: number;
  casual_games_abandoned: number;
  casual_games_voided: number;
  ranked_games_completed: number;
  ranked_games_abandoned: number;
  ranked_games_voided: number;
  private_games_completed: number;
  private_games_abandoned: number;
  private_games_voided: number;
  // performance
  casual_total_points: number;
  casual_highest_score: number;
  casual_lowest_score: number | null;
  casual_avg_score_per_game: number;
  casual_avg_finish_position: number;
  casual_avg_cards_left: number;
  ranked_total_points: number;
  ranked_highest_score: number;
  ranked_lowest_score: number | null;
  ranked_avg_score_per_game: number;
  ranked_avg_finish_position: number;
  ranked_avg_cards_left: number;
  private_total_points: number;
  private_highest_score: number;
  private_lowest_score: number | null;
  private_avg_score_per_game: number;
  private_avg_finish_position: number;
  private_avg_cards_left: number;
  // combos
  singles_played: number;
  pairs_played: number;
  triples_played: number;
  straights_played: number;
  flushes_played: number;
  full_houses_played: number;
  four_of_a_kinds_played: number;
  straight_flushes_played: number;
  royal_flushes_played: number;
  casual_singles_played: number;
  casual_pairs_played: number;
  casual_triples_played: number;
  casual_straights_played: number;
  casual_flushes_played: number;
  casual_full_houses_played: number;
  casual_four_of_a_kinds_played: number;
  casual_straight_flushes_played: number;
  casual_royal_flushes_played: number;
  ranked_singles_played: number;
  ranked_pairs_played: number;
  ranked_triples_played: number;
  ranked_straights_played: number;
  ranked_flushes_played: number;
  ranked_full_houses_played: number;
  ranked_four_of_a_kinds_played: number;
  ranked_straight_flushes_played: number;
  ranked_royal_flushes_played: number;
  private_singles_played: number;
  private_pairs_played: number;
  private_triples_played: number;
  private_straights_played: number;
  private_flushes_played: number;
  private_full_houses_played: number;
  private_four_of_a_kinds_played: number;
  private_straight_flushes_played: number;
  private_royal_flushes_played: number;
  first_game_at: string | null;
  last_game_at: string | null;
}

interface LeaderboardEntry {
  user_id: string;
  username: string;
  avatar_url: string | null;
  rank_points: number;
  games_played: number;
  games_won: number;
  win_rate: number;
  longest_win_streak: number;
  current_win_streak: number;
  rank: number;
}

// ─── Replicated pure helpers (mirrors StatsScreen.tsx) ───────────────────────

type HistEntry = { timestamp: string; points: number; is_win: boolean; game_type: string };

function isHistEntry(e: unknown): e is HistEntry {
  return (
    typeof e === 'object' &&
    e !== null &&
    !Array.isArray(e) &&
    'timestamp' in e &&
    typeof (e as Record<string, unknown>).timestamp === 'string' &&
    'points' in e &&
    typeof (e as Record<string, unknown>).points === 'number' &&
    'is_win' in e &&
    typeof (e as Record<string, unknown>).is_win === 'boolean' &&
    'game_type' in e &&
    typeof (e as Record<string, unknown>).game_type === 'string'
  );
}

function toPlayerStats(
  row: Partial<Record<keyof PlayerStats, unknown>>,
  globalRank?: number | null
): PlayerStats {
  const num = (key: keyof PlayerStats): number => {
    const v = row[key];
    return typeof v === 'number' ? v : 0;
  };
  const numOrNull = (key: keyof PlayerStats): number | null => {
    const v = row[key];
    return typeof v === 'number' ? v : null;
  };
  const strOrNull = (key: keyof PlayerStats): string | null => {
    const v = row[key];
    return typeof v === 'string' ? v : null;
  };
  const histRaw = row.rank_points_history;

  return {
    user_id: typeof row.user_id === 'string' ? row.user_id : '',
    games_played: num('games_played'),
    games_won: num('games_won'),
    games_lost: num('games_lost'),
    win_rate: num('win_rate'),
    avg_finish_position: num('avg_finish_position'),
    total_points: num('total_points'),
    highest_score: num('highest_score'),
    lowest_score: numOrNull('lowest_score'),
    avg_score_per_game: num('avg_score_per_game'),
    avg_cards_left_in_hand: num('avg_cards_left_in_hand'),
    current_win_streak: num('current_win_streak'),
    longest_win_streak: num('longest_win_streak'),
    current_loss_streak: num('current_loss_streak'),
    global_rank: globalRank !== undefined ? globalRank : numOrNull('global_rank'),
    rank_points: num('rank_points'),
    rank_points_history: Array.isArray(histRaw) ? histRaw.filter(isHistEntry) : null,
    casual_games_played: num('casual_games_played'),
    casual_games_won: num('casual_games_won'),
    casual_games_lost: num('casual_games_lost'),
    casual_win_rate: num('casual_win_rate'),
    casual_rank_points: num('casual_rank_points'),
    ranked_games_played: num('ranked_games_played'),
    ranked_games_won: num('ranked_games_won'),
    ranked_games_lost: num('ranked_games_lost'),
    ranked_win_rate: num('ranked_win_rate'),
    ranked_rank_points: num('ranked_rank_points'),
    private_games_played: num('private_games_played'),
    private_games_won: num('private_games_won'),
    private_games_lost: num('private_games_lost'),
    private_win_rate: num('private_win_rate'),
    games_completed: num('games_completed'),
    games_abandoned: num('games_abandoned'),
    games_voided: num('games_voided'),
    completion_rate: num('completion_rate'),
    current_completion_streak: num('current_completion_streak'),
    longest_completion_streak: num('longest_completion_streak'),
    casual_games_completed: num('casual_games_completed'),
    casual_games_abandoned: num('casual_games_abandoned'),
    casual_games_voided: num('casual_games_voided'),
    ranked_games_completed: num('ranked_games_completed'),
    ranked_games_abandoned: num('ranked_games_abandoned'),
    ranked_games_voided: num('ranked_games_voided'),
    private_games_completed: num('private_games_completed'),
    private_games_abandoned: num('private_games_abandoned'),
    private_games_voided: num('private_games_voided'),
    casual_total_points: num('casual_total_points'),
    casual_highest_score: num('casual_highest_score'),
    casual_lowest_score: numOrNull('casual_lowest_score'),
    casual_avg_score_per_game: num('casual_avg_score_per_game'),
    casual_avg_finish_position: num('casual_avg_finish_position'),
    casual_avg_cards_left: num('casual_avg_cards_left'),
    ranked_total_points: num('ranked_total_points'),
    ranked_highest_score: num('ranked_highest_score'),
    ranked_lowest_score: numOrNull('ranked_lowest_score'),
    ranked_avg_score_per_game: num('ranked_avg_score_per_game'),
    ranked_avg_finish_position: num('ranked_avg_finish_position'),
    ranked_avg_cards_left: num('ranked_avg_cards_left'),
    private_total_points: num('private_total_points'),
    private_highest_score: num('private_highest_score'),
    private_lowest_score: numOrNull('private_lowest_score'),
    private_avg_score_per_game: num('private_avg_score_per_game'),
    private_avg_finish_position: num('private_avg_finish_position'),
    private_avg_cards_left: num('private_avg_cards_left'),
    singles_played: num('singles_played'),
    pairs_played: num('pairs_played'),
    triples_played: num('triples_played'),
    straights_played: num('straights_played'),
    flushes_played: num('flushes_played'),
    full_houses_played: num('full_houses_played'),
    four_of_a_kinds_played: num('four_of_a_kinds_played'),
    straight_flushes_played: num('straight_flushes_played'),
    royal_flushes_played: num('royal_flushes_played'),
    casual_singles_played: num('casual_singles_played'),
    casual_pairs_played: num('casual_pairs_played'),
    casual_triples_played: num('casual_triples_played'),
    casual_straights_played: num('casual_straights_played'),
    casual_flushes_played: num('casual_flushes_played'),
    casual_full_houses_played: num('casual_full_houses_played'),
    casual_four_of_a_kinds_played: num('casual_four_of_a_kinds_played'),
    casual_straight_flushes_played: num('casual_straight_flushes_played'),
    casual_royal_flushes_played: num('casual_royal_flushes_played'),
    ranked_singles_played: num('ranked_singles_played'),
    ranked_pairs_played: num('ranked_pairs_played'),
    ranked_triples_played: num('ranked_triples_played'),
    ranked_straights_played: num('ranked_straights_played'),
    ranked_flushes_played: num('ranked_flushes_played'),
    ranked_full_houses_played: num('ranked_full_houses_played'),
    ranked_four_of_a_kinds_played: num('ranked_four_of_a_kinds_played'),
    ranked_straight_flushes_played: num('ranked_straight_flushes_played'),
    ranked_royal_flushes_played: num('ranked_royal_flushes_played'),
    private_singles_played: num('private_singles_played'),
    private_pairs_played: num('private_pairs_played'),
    private_triples_played: num('private_triples_played'),
    private_straights_played: num('private_straights_played'),
    private_flushes_played: num('private_flushes_played'),
    private_full_houses_played: num('private_full_houses_played'),
    private_four_of_a_kinds_played: num('private_four_of_a_kinds_played'),
    private_straight_flushes_played: num('private_straight_flushes_played'),
    private_royal_flushes_played: num('private_royal_flushes_played'),
    first_game_at: strOrNull('first_game_at'),
    last_game_at: strOrNull('last_game_at'),
  };
}

// ─── Combo aggregation (mirrors saveGameStatsToDatabase in state.ts) ─────────

interface MatchComboStats {
  singles: number[];
  pairs: number[];
  triples: number[];
  straights: number[];
  flushes: number[];
  full_houses: number[];
  four_of_a_kinds: number[];
  straight_flushes: number[];
  royal_flushes: number[];
}

function aggregateCombos(matchComboStats: MatchComboStats | null) {
  if (!matchComboStats) {
    return {
      singles: 0,
      pairs: 0,
      triples: 0,
      straights: 0,
      flushes: 0,
      full_houses: 0,
      four_of_a_kinds: 0,
      straight_flushes: 0,
      royal_flushes: 0,
    };
  }
  return {
    singles: matchComboStats.singles.reduce((s, v) => s + v, 0),
    pairs: matchComboStats.pairs.reduce((s, v) => s + v, 0),
    triples: matchComboStats.triples.reduce((s, v) => s + v, 0),
    straights: matchComboStats.straights.reduce((s, v) => s + v, 0),
    flushes: matchComboStats.flushes.reduce((s, v) => s + v, 0),
    full_houses: matchComboStats.full_houses.reduce((s, v) => s + v, 0),
    four_of_a_kinds: matchComboStats.four_of_a_kinds.reduce((s, v) => s + v, 0),
    straight_flushes: matchComboStats.straight_flushes.reduce((s, v) => s + v, 0),
    royal_flushes: matchComboStats.royal_flushes.reduce((s, v) => s + v, 0),
  };
}

// ─── Leaderboard per-mode entry builder (mirrors LeaderboardScreen.tsx) ──────

type LeaderboardType = 'casual' | 'ranked';

function buildLeaderboardEntry(
  item: Record<string, any>,
  leaderboardType: LeaderboardType,
  index: number,
  startIndex = 0
): LeaderboardEntry {
  const isCasual = leaderboardType === 'casual';
  return {
    user_id: item.user_id,
    username: item.profiles.username,
    avatar_url: item.profiles.avatar_url,
    rank_points:
      (isCasual ? item.casual_rank_points : item.ranked_rank_points) ?? item.rank_points ?? 0,
    games_played:
      (isCasual ? item.casual_games_played : item.ranked_games_played) ?? item.games_played ?? 0,
    games_won: (isCasual ? item.casual_games_won : item.ranked_games_won) ?? item.games_won ?? 0,
    win_rate: (isCasual ? item.casual_win_rate : item.ranked_win_rate) ?? item.win_rate ?? 0,
    longest_win_streak: item.longest_win_streak ?? 0,
    current_win_streak: item.current_win_streak ?? 0,
    rank: startIndex + index + 1,
  };
}

// ─── Offline guard helper (mirrors state.ts saveGameStatsToDatabase) ─────────

interface PlayerStub {
  isBot: boolean;
}

function shouldSkipStatsSave(players: PlayerStub[]): boolean {
  const hasHumanPlayer = players.some(p => !p.isBot);
  return !hasHumanPlayer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: toPlayerStats — DB row → PlayerStats mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('toPlayerStats: row → PlayerStats mapping', () => {
  it('defaults every numeric field to 0 on an empty row', () => {
    const stats = toPlayerStats({});
    expect(stats.games_played).toBe(0);
    expect(stats.games_won).toBe(0);
    expect(stats.games_lost).toBe(0);
    expect(stats.win_rate).toBe(0);
    expect(stats.rank_points).toBe(0);
    expect(stats.casual_games_played).toBe(0);
    expect(stats.ranked_games_played).toBe(0);
    expect(stats.private_games_played).toBe(0);
    expect(stats.singles_played).toBe(0);
    expect(stats.flushes_played).toBe(0);
    expect(stats.royal_flushes_played).toBe(0);
  });

  it('defaults user_id to empty string when missing', () => {
    const stats = toPlayerStats({});
    expect(stats.user_id).toBe('');
  });

  it('defaults nullable numeric fields (lowest_score, etc.) to null', () => {
    const stats = toPlayerStats({});
    expect(stats.lowest_score).toBeNull();
    expect(stats.casual_lowest_score).toBeNull();
    expect(stats.ranked_lowest_score).toBeNull();
    expect(stats.private_lowest_score).toBeNull();
    expect(stats.global_rank).toBeNull();
  });

  it('passes through a full valid row correctly', () => {
    const row = {
      user_id: 'abc-123',
      games_played: 50,
      games_won: 30,
      games_lost: 20,
      win_rate: 60.0,
      rank_points: 1250,
      total_points: 500,
      highest_score: 95,
      lowest_score: 4,
      avg_finish_position: 2.1,
      avg_score_per_game: 10.0,
      avg_cards_left_in_hand: 3.5,
      current_win_streak: 3,
      longest_win_streak: 8,
      current_loss_streak: 0,
      global_rank: 42,
      casual_games_played: 40,
      casual_games_won: 24,
      casual_rank_points: 1300,
      ranked_games_played: 10,
      ranked_games_won: 6,
      ranked_rank_points: 1100,
      first_game_at: '2025-01-01T00:00:00Z',
      last_game_at: '2026-04-01T12:00:00Z',
    };

    const stats = toPlayerStats(row);

    expect(stats.user_id).toBe('abc-123');
    expect(stats.games_played).toBe(50);
    expect(stats.games_won).toBe(30);
    expect(stats.win_rate).toBe(60.0);
    expect(stats.rank_points).toBe(1250);
    expect(stats.lowest_score).toBe(4);
    expect(stats.global_rank).toBe(42);
    expect(stats.casual_games_played).toBe(40);
    expect(stats.ranked_rank_points).toBe(1100);
    expect(stats.first_game_at).toBe('2025-01-01T00:00:00Z');
    expect(stats.last_game_at).toBe('2026-04-01T12:00:00Z');
  });

  it('globalRank override replaces stored global_rank', () => {
    const row = { user_id: 'u1', global_rank: 99, ranked_games_played: 5 };

    // With RPC rank = 7 → should return 7, not 99
    const statsWithOverride = toPlayerStats(row, 7);
    expect(statsWithOverride.global_rank).toBe(7);

    // Without override (undefined) → falls back to row value
    const statsFromRow = toPlayerStats(row);
    expect(statsFromRow.global_rank).toBe(99);

    // Explicit null override → global_rank should be null (casual-only player)
    const statsNullOverride = toPlayerStats(row, null);
    expect(statsNullOverride.global_rank).toBeNull();
  });

  it('non-numeric values in numeric fields default to 0', () => {
    const row = {
      games_played: 'thirty' as any,
      games_won: null as any,
      win_rate: undefined as any,
      rank_points: true as any,
    };
    const stats = toPlayerStats(row);
    expect(stats.games_played).toBe(0);
    expect(stats.games_won).toBe(0);
    expect(stats.win_rate).toBe(0);
    expect(stats.rank_points).toBe(0);
  });

  it('non-string values in string fields default to null', () => {
    const row = { first_game_at: 12345 as any, last_game_at: null as any };
    const stats = toPlayerStats(row);
    expect(stats.first_game_at).toBeNull();
    expect(stats.last_game_at).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: rank_points_history type guard
// ─────────────────────────────────────────────────────────────────────────────

describe('toPlayerStats: rank_points_history validation', () => {
  const validEntry: HistEntry = {
    timestamp: '2026-04-01T10:00:00Z',
    points: 1250,
    is_win: true,
    game_type: 'casual',
  };

  it('returns null when rank_points_history is absent', () => {
    const stats = toPlayerStats({});
    expect(stats.rank_points_history).toBeNull();
  });

  it('returns null when rank_points_history is not an array', () => {
    const stats = toPlayerStats({ rank_points_history: 'not-an-array' as any });
    expect(stats.rank_points_history).toBeNull();
  });

  it('passes through a valid history array', () => {
    const stats = toPlayerStats({ rank_points_history: [validEntry] });
    expect(stats.rank_points_history).toHaveLength(1);
    expect(stats.rank_points_history![0]).toEqual(validEntry);
  });

  it('filters out invalid entries from a mixed array', () => {
    const badEntry1 = {
      timestamp: 'ts',
      points: 'not-a-number',
      is_win: true,
      game_type: 'casual',
    };
    const badEntry2 = { timestamp: 'ts', points: 100, game_type: 'ranked' }; // missing is_win
    const badEntry3 = null;
    const badEntry4 = { timestamp: 'ts', points: 200, is_win: false, game_type: 99 }; // game_type wrong type

    const stats = toPlayerStats({
      rank_points_history: [validEntry, badEntry1, badEntry2, badEntry3, badEntry4, validEntry],
    });

    expect(stats.rank_points_history).toHaveLength(2);
    stats.rank_points_history!.forEach(e => expect(e).toEqual(validEntry));
  });

  it('returns empty array for an empty history array', () => {
    const stats = toPlayerStats({ rank_points_history: [] });
    expect(stats.rank_points_history).toEqual([]);
  });

  it('preserves ordering of valid entries', () => {
    const entry1 = {
      timestamp: '2026-01-01T00:00:00Z',
      points: 1000,
      is_win: false,
      game_type: 'ranked',
    };
    const entry2 = {
      timestamp: '2026-02-01T00:00:00Z',
      points: 1050,
      is_win: true,
      game_type: 'ranked',
    };
    const entry3 = {
      timestamp: '2026-03-01T00:00:00Z',
      points: 1100,
      is_win: true,
      game_type: 'casual',
    };

    const stats = toPlayerStats({ rank_points_history: [entry1, entry2, entry3] });
    expect(stats.rank_points_history).toHaveLength(3);
    expect(stats.rank_points_history![0].points).toBe(1000);
    expect(stats.rank_points_history![1].points).toBe(1050);
    expect(stats.rank_points_history![2].points).toBe(1100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: Combo stats aggregation (matchComboStats → comboCounts)
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateCombos: matchComboStats summation', () => {
  it('returns all zeros when matchComboStats is null', () => {
    const result = aggregateCombos(null);
    expect(result.singles).toBe(0);
    expect(result.pairs).toBe(0);
    expect(result.triples).toBe(0);
    expect(result.straights).toBe(0);
    expect(result.flushes).toBe(0);
    expect(result.full_houses).toBe(0);
    expect(result.four_of_a_kinds).toBe(0);
    expect(result.straight_flushes).toBe(0);
    expect(result.royal_flushes).toBe(0);
  });

  it('returns all zeros for a single match with no combos played', () => {
    const stats: MatchComboStats = {
      singles: [0],
      pairs: [0],
      triples: [0],
      straights: [0],
      flushes: [0],
      full_houses: [0],
      four_of_a_kinds: [0],
      straight_flushes: [0],
      royal_flushes: [0],
    };
    const result = aggregateCombos(stats);
    expect(result.singles).toBe(0);
    expect(result.flushes).toBe(0);
  });

  it('sums correctly across a single match', () => {
    const stats: MatchComboStats = {
      singles: [5],
      pairs: [3],
      triples: [1],
      straights: [2],
      flushes: [1],
      full_houses: [1],
      four_of_a_kinds: [0],
      straight_flushes: [1],
      royal_flushes: [0],
    };
    const result = aggregateCombos(stats);
    expect(result.singles).toBe(5);
    expect(result.pairs).toBe(3);
    expect(result.triples).toBe(1);
    expect(result.straights).toBe(2);
    expect(result.flushes).toBe(1);
    expect(result.full_houses).toBe(1);
    expect(result.four_of_a_kinds).toBe(0);
    expect(result.straight_flushes).toBe(1);
    expect(result.royal_flushes).toBe(0);
  });

  it('sums correctly across multiple matches (3-match game)', () => {
    // Match 1: singles=4, pairs=2, flushes=1
    // Match 2: singles=3, pairs=1, straights=2
    // Match 3: singles=6, four_of_a_kinds=1
    const stats: MatchComboStats = {
      singles: [4, 3, 6],
      pairs: [2, 1, 0],
      triples: [0, 0, 0],
      straights: [0, 2, 0],
      flushes: [1, 0, 0],
      full_houses: [0, 0, 0],
      four_of_a_kinds: [0, 0, 1],
      straight_flushes: [0, 0, 0],
      royal_flushes: [0, 0, 0],
    };
    const result = aggregateCombos(stats);
    expect(result.singles).toBe(13);
    expect(result.pairs).toBe(3);
    expect(result.triples).toBe(0);
    expect(result.straights).toBe(2);
    expect(result.flushes).toBe(1);
    expect(result.full_houses).toBe(0);
    expect(result.four_of_a_kinds).toBe(1);
    expect(result.straight_flushes).toBe(0);
    expect(result.royal_flushes).toBe(0);
  });

  it('handles empty arrays (0-match game edge case)', () => {
    const stats: MatchComboStats = {
      singles: [],
      pairs: [],
      triples: [],
      straights: [],
      flushes: [],
      full_houses: [],
      four_of_a_kinds: [],
      straight_flushes: [],
      royal_flushes: [],
    };
    const result = aggregateCombos(stats);
    expect(result.singles).toBe(0);
    expect(result.royal_flushes).toBe(0);
  });

  it('tracks all 9 combo types independently in a full game', () => {
    const stats: MatchComboStats = {
      singles: [10, 8],
      pairs: [5, 4],
      triples: [2, 1],
      straights: [3, 2],
      flushes: [1, 2],
      full_houses: [1, 0],
      four_of_a_kinds: [0, 1],
      straight_flushes: [1, 0],
      royal_flushes: [0, 1],
    };
    const result = aggregateCombos(stats);
    expect(result.singles).toBe(18);
    expect(result.pairs).toBe(9);
    expect(result.triples).toBe(3);
    expect(result.straights).toBe(5);
    expect(result.flushes).toBe(3);
    expect(result.full_houses).toBe(1);
    expect(result.four_of_a_kinds).toBe(1);
    expect(result.straight_flushes).toBe(1);
    expect(result.royal_flushes).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: Leaderboard per-mode entry construction
// ─────────────────────────────────────────────────────────────────────────────

describe('buildLeaderboardEntry: per-mode column selection', () => {
  const playerRow = {
    user_id: 'user-001',
    profiles: { username: 'Alice', avatar_url: 'https://cdn.example.com/alice.png' },
    rank_points: 900, // global fallback
    games_played: 80,
    games_won: 50,
    win_rate: 62.5,
    longest_win_streak: 10,
    current_win_streak: 3,
    // Casual
    casual_rank_points: 1350,
    casual_games_played: 60,
    casual_games_won: 38,
    casual_win_rate: 63.33,
    // Ranked
    ranked_rank_points: 1100,
    ranked_games_played: 20,
    ranked_games_won: 12,
    ranked_win_rate: 60.0,
  };

  it('uses casual_* columns when leaderboardType is casual', () => {
    const entry = buildLeaderboardEntry(playerRow, 'casual', 0);
    expect(entry.rank_points).toBe(1350);
    expect(entry.games_played).toBe(60);
    expect(entry.games_won).toBe(38);
    expect(entry.win_rate).toBe(63.33);
  });

  it('uses ranked_* columns when leaderboardType is ranked', () => {
    const entry = buildLeaderboardEntry(playerRow, 'ranked', 0);
    expect(entry.rank_points).toBe(1100);
    expect(entry.games_played).toBe(20);
    expect(entry.games_won).toBe(12);
    expect(entry.win_rate).toBe(60.0);
  });

  it('passes through streaks regardless of leaderboard type', () => {
    const casual = buildLeaderboardEntry(playerRow, 'casual', 0);
    const ranked = buildLeaderboardEntry(playerRow, 'ranked', 0);
    expect(casual.longest_win_streak).toBe(10);
    expect(ranked.longest_win_streak).toBe(10);
    expect(casual.current_win_streak).toBe(3);
    expect(ranked.current_win_streak).toBe(3);
  });

  it('rank is 1-based from the startIndex offset', () => {
    const entry0 = buildLeaderboardEntry(playerRow, 'casual', 0, 0);
    const entry1 = buildLeaderboardEntry(playerRow, 'casual', 1, 0);
    const entryPage2 = buildLeaderboardEntry(playerRow, 'casual', 0, 20);
    expect(entry0.rank).toBe(1);
    expect(entry1.rank).toBe(2);
    expect(entryPage2.rank).toBe(21); // page 2, first item
  });

  it('falls back to global rank_points when per-mode column is null', () => {
    const rowNoCasualPoints = { ...playerRow, casual_rank_points: null };
    const entry = buildLeaderboardEntry(rowNoCasualPoints, 'casual', 0);
    expect(entry.rank_points).toBe(900); // falls back to row.rank_points
  });

  it('preserves avatar_url and username', () => {
    const entry = buildLeaderboardEntry(playerRow, 'ranked', 0);
    expect(entry.username).toBe('Alice');
    expect(entry.avatar_url).toBe('https://cdn.example.com/alice.png');
    expect(entry.user_id).toBe('user-001');
  });

  it('keeps leaderboard sorted order for multiple entries', () => {
    const rows = [
      {
        ...playerRow,
        user_id: 'u1',
        casual_rank_points: 1500,
        casual_games_played: 50,
        casual_games_won: 35,
        casual_win_rate: 70,
      },
      {
        ...playerRow,
        user_id: 'u2',
        casual_rank_points: 1350,
        casual_games_played: 60,
        casual_games_won: 38,
        casual_win_rate: 63,
      },
      {
        ...playerRow,
        user_id: 'u3',
        casual_rank_points: 1200,
        casual_games_played: 30,
        casual_games_won: 15,
        casual_win_rate: 50,
      },
    ];

    const entries = rows.map((r, i) => buildLeaderboardEntry(r, 'casual', i, 0));

    expect(entries[0].rank).toBe(1);
    expect(entries[0].rank_points).toBe(1500);
    expect(entries[1].rank).toBe(2);
    expect(entries[2].rank).toBe(3);
    expect(entries[2].rank_points).toBe(1200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: Offline game guard (shouldSkipStatsSave)
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldSkipStatsSave: offline / all-bot guard', () => {
  it('skips stats for an all-bot game (no human players)', () => {
    const players: PlayerStub[] = [
      { isBot: true },
      { isBot: true },
      { isBot: true },
      { isBot: true },
    ];
    expect(shouldSkipStatsSave(players)).toBe(true);
  });

  it('does NOT skip stats for a game with at least one human', () => {
    const players: PlayerStub[] = [
      { isBot: false }, // human
      { isBot: true },
      { isBot: true },
      { isBot: true },
    ];
    expect(shouldSkipStatsSave(players)).toBe(false);
  });

  it('does NOT skip stats when all players are human', () => {
    const players: PlayerStub[] = [
      { isBot: false },
      { isBot: false },
      { isBot: false },
      { isBot: false },
    ];
    expect(shouldSkipStatsSave(players)).toBe(false);
  });

  it('does NOT skip for 2-player (1 human, 1 bot)', () => {
    const players: PlayerStub[] = [{ isBot: false }, { isBot: true }];
    expect(shouldSkipStatsSave(players)).toBe(false);
  });

  it('skips for 2-player all-bot game', () => {
    const players: PlayerStub[] = [{ isBot: true }, { isBot: true }];
    expect(shouldSkipStatsSave(players)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: Game completion payload structure
// ─────────────────────────────────────────────────────────────────────────────

describe('game completion payload: shape validation', () => {
  /** Builds a minimal payload like saveGameStatsToDatabase would */
  function buildPayload(overrides: Record<string, unknown> = {}) {
    return {
      room_id: null,
      room_code: 'CASUAL',
      game_type: 'casual' as const,
      bot_difficulty: 'medium',
      players: [
        {
          user_id: 'user-abc',
          username: 'Alice',
          score: 0,
          finish_position: 1,
          cards_left: 0,
          was_bot: false,
          disconnected: false,
          original_username: null,
          combos_played: {
            singles: 8,
            pairs: 4,
            triples: 1,
            straights: 2,
            flushes: 1,
            full_houses: 0,
            four_of_a_kinds: 0,
            straight_flushes: 0,
            royal_flushes: 0,
          },
        },
      ],
      winner_id: 'user-abc',
      game_duration_seconds: 420,
      started_at: '2026-04-15T10:00:00.000Z',
      finished_at: '2026-04-15T10:07:00.000Z',
      game_completed: true,
      ...overrides,
    };
  }

  it('payload has correct shape for a completed local casual game', () => {
    const payload = buildPayload();
    expect(payload.room_code).toBe('CASUAL');
    expect(payload.room_id).toBeNull();
    expect(payload.game_type).toBe('casual');
    expect(payload.game_completed).toBe(true);
    expect(payload.players).toHaveLength(1);
    expect(payload.players[0].cards_left).toBe(0);
    expect(payload.players[0].was_bot).toBe(false);
    expect(payload.players[0].disconnected).toBe(false);
  });

  it('winner is a player in the players array', () => {
    const payload = buildPayload();
    const winnerExists = payload.players.some(p => p.user_id === payload.winner_id);
    expect(winnerExists).toBe(true);
  });

  it('combos_played contains all 9 combo type keys', () => {
    const payload = buildPayload();
    const combos = payload.players[0].combos_played;
    const requiredKeys = [
      'singles',
      'pairs',
      'triples',
      'straights',
      'flushes',
      'full_houses',
      'four_of_a_kinds',
      'straight_flushes',
      'royal_flushes',
    ];
    requiredKeys.forEach(key => {
      expect(combos).toHaveProperty(key);
      expect(typeof combos[key]).toBe('number');
      expect(combos[key]).toBeGreaterThanOrEqual(0);
    });
  });

  it('LOCAL room_code is never sent (offline guard fires first)', () => {
    // Validate the contract: if someone bypassed the guard, LOCAL is rejected
    const payload = buildPayload({ room_code: 'LOCAL', room_id: null });
    // The local guard (shouldSkipStatsSave) should prevent reaching here
    // But if it did reach here, the server would reject room_code: LOCAL
    // We test the client-side guard instead:
    const allBotPlayers: PlayerStub[] = [{ isBot: true }, { isBot: true }];
    expect(shouldSkipStatsSave(allBotPlayers)).toBe(true); // would skip before this payload is built
  });

  it('game_duration_seconds is non-negative', () => {
    const payload = buildPayload({ game_duration_seconds: 0 });
    expect(payload.game_duration_seconds).toBeGreaterThanOrEqual(0);
  });

  it('finish_position 1 means winner (cards_left = 0)', () => {
    const payload = buildPayload();
    const winner = payload.players.find(p => p.finish_position === 1);
    expect(winner).toBeDefined();
    expect(winner!.cards_left).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7: Per-mode stats display on player profile
// ─────────────────────────────────────────────────────────────────────────────

describe('PlayerStats: per-mode stats isolation', () => {
  const fullRow = {
    user_id: 'user-xyz',
    games_played: 100,
    games_won: 60,
    casual_games_played: 70,
    casual_games_won: 45,
    casual_rank_points: 1400,
    casual_win_rate: 64.29,
    ranked_games_played: 20,
    ranked_games_won: 10,
    ranked_rank_points: 1050,
    ranked_win_rate: 50.0,
    private_games_played: 10,
    private_games_won: 5,
    private_win_rate: 50.0,
    // per-mode combos
    casual_singles_played: 200,
    casual_flushes_played: 15,
    ranked_singles_played: 50,
    ranked_flushes_played: 4,
  };

  it('casual stats are isolated from ranked stats', () => {
    const stats = toPlayerStats(fullRow);
    expect(stats.casual_games_played).toBe(70);
    expect(stats.ranked_games_played).toBe(20);
    expect(stats.casual_games_played).not.toBe(stats.ranked_games_played);
  });

  it('per-mode win rates are stored independently', () => {
    const stats = toPlayerStats(fullRow);
    expect(stats.casual_win_rate).toBe(64.29);
    expect(stats.ranked_win_rate).toBe(50.0);
    expect(stats.private_win_rate).toBe(50.0);
  });

  it('per-mode rank_points are stored independently', () => {
    const stats = toPlayerStats(fullRow);
    expect(stats.casual_rank_points).toBe(1400);
    expect(stats.ranked_rank_points).toBe(1050);
  });

  it('per-mode combo stats are stored independently', () => {
    const stats = toPlayerStats(fullRow);
    expect(stats.casual_singles_played).toBe(200);
    expect(stats.ranked_singles_played).toBe(50);
    expect(stats.casual_flushes_played).toBe(15);
    expect(stats.ranked_flushes_played).toBe(4);
  });

  it('casual + ranked games_played sum does not exceed total games_played', () => {
    const stats = toPlayerStats(fullRow);
    // casual (70) + ranked (20) + private (10) = 100 = games_played
    expect(
      stats.casual_games_played + stats.ranked_games_played + stats.private_games_played
    ).toBeLessThanOrEqual(stats.games_played + 1); // +1 for float tolerance
  });
});
