// @ts-nocheck
/**
 * 4-Player Rank Points Simulation — 40 games per mode (v3)
 *
 * ── CASUAL RANK POINTS (score-based) ──────────────────────────────────────────
 *   Completed : delta = ROUND((100 - score) × bot_multiplier)   ← NO cap
 *               • score  0       → winner   → +100 × mult
 *               • score  1–99   → positive delta
 *               • score  100    → 0
 *               • score  101+   → NEGATIVE delta   ← key rule
 *   Abandoned : fixed −25 for ALL players in game, regardless of score or mult
 *   Voided    : 0 for all players (game nullified)
 *   Floor     : none — rank points can go negative and recover
 *
 * ── RANKED RANK POINTS (K=32 pairwise ELO) ────────────────────────────────────
 *   For each unique pair (i,j) where pos_i < pos_j (winner beats loser):
 *     expected = 1 / (1 + 10^((loser_rating − winner_rating) / 400))
 *     winner  += ROUND(32 × (1 − expected))
 *     loser   −= same amount   ← zero-sum per pair
 *   Voided    : all ELO frozen (0 delta)
 *   Abandoned : abandoning player assigned pos=4 (LAST PLACE) for ELO,
 *               remaining 3 players receive positions 1/2/3 from their actual finish.
 *               ELO computed normally. Abandoner typically loses the most.
 *   Floor     : none — rank points can go negative and recover
 *
 * ── SCHEDULES ────────────────────────────────────────────────────────────────
 *   Each mode: 30 COMPLETED + 5 VOIDED + 5 ABANDONED = 40 games total
 *   bot_multiplier = 1.0 throughout; all players start at 1000
 *
 *   Casual  — 22 of 30 completed games feature at least one player with score 101+
 *             (those players receive a NEGATIVE delta, clearly shown in score column)
 *
 *   Ranked  — 5 abandoned games show one player per game abandoning:
 *             RA1 Alice abandons, RA2 Bob, RA3 Charlie, RA4 Dave, RA5 Alice again
 *
 * ── PRE-COMPUTED FINALS ───────────────────────────────────────────────────────
 *   Casual : Alice=2801  Bob=2588  Charlie=2185  Dave=2701
 *   Ranked : Alice=984   Bob=983   Charlie=996   Dave=1037
 */

import * as fs from 'fs';
import * as path from 'path';

const print = (...args: any[]) => process.stdout.write(args.map(String).join(' ') + '\n');

// ─── Engines ────────────────────────────────────────────────────────────────

/** Casual rank-points delta. NO score cap — score 101+ yields negative delta. */
function casualDelta(
  score: number,
  gameType: 'completed' | 'voided' | 'abandoned',
  mult = 1.0
): number {
  if (gameType === 'abandoned') return -25;
  if (gameType === 'voided') return 0;
  return Math.round((100 - score) * mult);
}

/** K=32 pairwise ELO — returns player→delta map */
function computeEloDelta(
  players: Array<{ player: string; pos: number; r: number }>
): Map<string, number> {
  const K = 32;
  const d = new Map<string, number>(players.map(p => [p.player, 0]));
  for (let a = 0; a < players.length; a++) {
    for (let b = a + 1; b < players.length; b++) {
      if (players[a].pos === players[b].pos) continue;
      const [w, l] =
        players[a].pos < players[b].pos ? [players[a], players[b]] : [players[b], players[a]];
      const expected = 1 / (1 + Math.pow(10, (l.r - w.r) / 400));
      const wd = Math.round(K * (1 - expected));
      d.set(w.player, d.get(w.player)! + wd);
      d.set(l.player, d.get(l.player)! - wd);
    }
  }
  return d;
}

// ─── Types & helpers ────────────────────────────────────────────────────────

type State = { Alice: number; Bob: number; Charlie: number; Dave: number };
const PLAYERS = ['Alice', 'Bob', 'Charlie', 'Dave'] as const;

function applyFloor(s: State): State {
  // No floor — rank points can go negative and recover
  return { ...s };
}

// ─── Casual game schedule ───────────────────────────────────────────────────

interface CasualResult {
  p: string;
  s: number;
}
interface CasualGame {
  label: string;
  type: 'completed' | 'voided' | 'abandoned';
  r?: CasualResult[];
}

const CASUAL_GAMES: CasualGame[] = [
  // ── 30 COMPLETED ─────────────────────────────────────────────────────────
  {
    label: 'C1',
    type: 'completed',
    r: [
      { p: 'Alice', s: 0 },
      { p: 'Bob', s: 25 },
      { p: 'Charlie', s: 45 },
      { p: 'Dave', s: 110 },
    ],
  },
  {
    label: 'C2',
    type: 'completed',
    r: [
      { p: 'Bob', s: 0 },
      { p: 'Alice', s: 30 },
      { p: 'Dave', s: 50 },
      { p: 'Charlie', s: 120 },
    ],
  },
  {
    label: 'C3',
    type: 'completed',
    r: [
      { p: 'Charlie', s: 0 },
      { p: 'Dave', s: 18 },
      { p: 'Alice', s: 35 },
      { p: 'Bob', s: 105 },
    ],
  },
  {
    label: 'C4',
    type: 'completed',
    r: [
      { p: 'Dave', s: 0 },
      { p: 'Charlie', s: 22 },
      { p: 'Bob', s: 55 },
      { p: 'Alice', s: 115 },
    ],
  },
  {
    label: 'C5',
    type: 'completed',
    r: [
      { p: 'Alice', s: 0 },
      { p: 'Bob', s: 8 },
      { p: 'Charlie', s: 110 },
      { p: 'Dave', s: 130 },
    ],
  },
  {
    label: 'C6',
    type: 'completed',
    r: [
      { p: 'Bob', s: 0 },
      { p: 'Dave', s: 12 },
      { p: 'Alice', s: 102 },
      { p: 'Charlie', s: 145 },
    ],
  },
  {
    label: 'C7',
    type: 'completed',
    r: [
      { p: 'Charlie', s: 0 },
      { p: 'Alice', s: 5 },
      { p: 'Dave', s: 20 },
      { p: 'Bob', s: 160 },
    ],
  },
  {
    label: 'C8',
    type: 'completed',
    r: [
      { p: 'Dave', s: 0 },
      { p: 'Bob', s: 15 },
      { p: 'Alice', s: 25 },
      { p: 'Charlie', s: 180 },
    ],
  },
  {
    label: 'C9',
    type: 'completed',
    r: [
      { p: 'Alice', s: 0 },
      { p: 'Charlie', s: 10 },
      { p: 'Bob', s: 40 },
      { p: 'Dave', s: 200 },
    ],
  },
  {
    label: 'C10',
    type: 'completed',
    r: [
      { p: 'Bob', s: 0 },
      { p: 'Alice', s: 20 },
      { p: 'Charlie', s: 30 },
      { p: 'Dave', s: 95 },
    ],
  },
  {
    label: 'C11',
    type: 'completed',
    r: [
      { p: 'Charlie', s: 0 },
      { p: 'Dave', s: 8 },
      { p: 'Bob', s: 12 },
      { p: 'Alice', s: 75 },
    ],
  },
  {
    label: 'C12',
    type: 'completed',
    r: [
      { p: 'Dave', s: 0 },
      { p: 'Bob', s: 5 },
      { p: 'Alice', s: 18 },
      { p: 'Charlie', s: 88 },
    ],
  },
  {
    label: 'C13',
    type: 'completed',
    r: [
      { p: 'Alice', s: 0 },
      { p: 'Dave', s: 14 },
      { p: 'Charlie', s: 22 },
      { p: 'Bob', s: 99 },
    ],
  },
  {
    label: 'C14',
    type: 'completed',
    r: [
      { p: 'Bob', s: 0 },
      { p: 'Charlie', s: 6 },
      { p: 'Dave', s: 28 },
      { p: 'Alice', s: 150 },
    ],
  },
  {
    label: 'C15',
    type: 'completed',
    r: [
      { p: 'Charlie', s: 0 },
      { p: 'Alice', s: 3 },
      { p: 'Bob', s: 16 },
      { p: 'Dave', s: 125 },
    ],
  },
  {
    label: 'C16',
    type: 'completed',
    r: [
      { p: 'Dave', s: 0 },
      { p: 'Alice', s: 9 },
      { p: 'Bob', s: 44 },
      { p: 'Charlie', s: 108 },
    ],
  },
  {
    label: 'C17',
    type: 'completed',
    r: [
      { p: 'Alice', s: 0 },
      { p: 'Bob', s: 11 },
      { p: 'Dave', s: 33 },
      { p: 'Charlie', s: 140 },
    ],
  },
  {
    label: 'C18',
    type: 'completed',
    r: [
      { p: 'Bob', s: 0 },
      { p: 'Dave', s: 2 },
      { p: 'Alice', s: 19 },
      { p: 'Charlie', s: 112 },
    ],
  },
  {
    label: 'C19',
    type: 'completed',
    r: [
      { p: 'Charlie', s: 0 },
      { p: 'Bob', s: 7 },
      { p: 'Dave', s: 24 },
      { p: 'Alice', s: 155 },
    ],
  },
  {
    label: 'C20',
    type: 'completed',
    r: [
      { p: 'Dave', s: 0 },
      { p: 'Alice', s: 13 },
      { p: 'Charlie', s: 36 },
      { p: 'Bob', s: 175 },
    ],
  },
  {
    label: 'C21',
    type: 'completed',
    r: [
      { p: 'Alice', s: 0 },
      { p: 'Charlie', s: 15 },
      { p: 'Bob', s: 42 },
      { p: 'Dave', s: 85 },
    ],
  },
  {
    label: 'C22',
    type: 'completed',
    r: [
      { p: 'Bob', s: 0 },
      { p: 'Dave', s: 4 },
      { p: 'Charlie', s: 28 },
      { p: 'Alice', s: 90 },
    ],
  },
  {
    label: 'C23',
    type: 'completed',
    r: [
      { p: 'Charlie', s: 0 },
      { p: 'Alice', s: 11 },
      { p: 'Dave', s: 38 },
      { p: 'Bob', s: 78 },
    ],
  },
  {
    label: 'C24',
    type: 'completed',
    r: [
      { p: 'Dave', s: 0 },
      { p: 'Bob', s: 9 },
      { p: 'Alice', s: 21 },
      { p: 'Charlie', s: 92 },
    ],
  },
  {
    label: 'C25',
    type: 'completed',
    r: [
      { p: 'Alice', s: 0 },
      { p: 'Bob', s: 17 },
      { p: 'Charlie', s: 34 },
      { p: 'Dave', s: 102 },
    ],
  },
  {
    label: 'C26',
    type: 'completed',
    r: [
      { p: 'Bob', s: 0 },
      { p: 'Alice', s: 6 },
      { p: 'Dave', s: 15 },
      { p: 'Charlie', s: 118 },
    ],
  },
  {
    label: 'C27',
    type: 'completed',
    r: [
      { p: 'Charlie', s: 0 },
      { p: 'Dave', s: 3 },
      { p: 'Bob', s: 29 },
      { p: 'Alice', s: 135 },
    ],
  },
  {
    label: 'C28',
    type: 'completed',
    r: [
      { p: 'Dave', s: 0 },
      { p: 'Charlie', s: 11 },
      { p: 'Alice', s: 23 },
      { p: 'Bob', s: 145 },
    ],
  },
  {
    label: 'C29',
    type: 'completed',
    r: [
      { p: 'Alice', s: 0 },
      { p: 'Charlie', s: 8 },
      { p: 'Dave', s: 26 },
      { p: 'Bob', s: 190 },
    ],
  },
  {
    label: 'C30',
    type: 'completed',
    r: [
      { p: 'Bob', s: 0 },
      { p: 'Alice', s: 14 },
      { p: 'Dave', s: 32 },
      { p: 'Charlie', s: 210 },
    ],
  },
  // ── 5 VOIDED ─────────────────────────────────────────────────────────────
  { label: 'CV1', type: 'voided' },
  { label: 'CV2', type: 'voided' },
  { label: 'CV3', type: 'voided' },
  { label: 'CV4', type: 'voided' },
  { label: 'CV5', type: 'voided' },
  // ── 5 ABANDONED ──────────────────────────────────────────────────────────
  { label: 'CA1', type: 'abandoned' },
  { label: 'CA2', type: 'abandoned' },
  { label: 'CA3', type: 'abandoned' },
  { label: 'CA4', type: 'abandoned' },
  { label: 'CA5', type: 'abandoned' },
];

// ─── Casual simulation ──────────────────────────────────────────────────────

interface CasualSnap {
  delta: State;
  state: State;
}

function runCasualSim(): CasualSnap[] {
  let s: State = { Alice: 1000, Bob: 1000, Charlie: 1000, Dave: 1000 };
  return CASUAL_GAMES.map(g => {
    const delta: State = { Alice: 0, Bob: 0, Charlie: 0, Dave: 0 };
    if (g.type === 'voided') {
      // all 0 — s unchanged
    } else if (g.type === 'abandoned') {
      PLAYERS.forEach(p => {
        delta[p] = -25;
      });
    } else {
      g.r!.forEach(res => {
        delta[res.p] = casualDelta(res.s, 'completed');
      });
    }
    const next = applyFloor({
      Alice: s.Alice + delta.Alice,
      Bob: s.Bob + delta.Bob,
      Charlie: s.Charlie + delta.Charlie,
      Dave: s.Dave + delta.Dave,
    });
    s = next;
    return { delta: { ...delta }, state: { ...next } };
  });
}

const CS = runCasualSim();

// ─── Ranked game schedule ───────────────────────────────────────────────────

interface RankedResult {
  p: string;
  pos: number;
}
interface RankedGame {
  label: string;
  type: 'completed' | 'voided' | 'abandoned';
  abandoner?: string;
  r?: RankedResult[];
}

const RANKED_GAMES: RankedGame[] = [
  // ── 30 COMPLETED ─────────────────────────────────────────────────────────
  {
    label: 'R1',
    type: 'completed',
    r: [
      { p: 'Alice', pos: 1 },
      { p: 'Bob', pos: 2 },
      { p: 'Charlie', pos: 3 },
      { p: 'Dave', pos: 4 },
    ],
  },
  {
    label: 'R2',
    type: 'completed',
    r: [
      { p: 'Dave', pos: 1 },
      { p: 'Charlie', pos: 2 },
      { p: 'Bob', pos: 3 },
      { p: 'Alice', pos: 4 },
    ],
  },
  {
    label: 'R3',
    type: 'completed',
    r: [
      { p: 'Bob', pos: 1 },
      { p: 'Alice', pos: 2 },
      { p: 'Dave', pos: 3 },
      { p: 'Charlie', pos: 4 },
    ],
  },
  {
    label: 'R4',
    type: 'completed',
    r: [
      { p: 'Charlie', pos: 1 },
      { p: 'Dave', pos: 2 },
      { p: 'Alice', pos: 3 },
      { p: 'Bob', pos: 4 },
    ],
  },
  {
    label: 'R5',
    type: 'completed',
    r: [
      { p: 'Alice', pos: 1 },
      { p: 'Charlie', pos: 2 },
      { p: 'Dave', pos: 3 },
      { p: 'Bob', pos: 4 },
    ],
  },
  {
    label: 'R6',
    type: 'completed',
    r: [
      { p: 'Bob', pos: 1 },
      { p: 'Dave', pos: 2 },
      { p: 'Charlie', pos: 3 },
      { p: 'Alice', pos: 4 },
    ],
  },
  {
    label: 'R7',
    type: 'completed',
    r: [
      { p: 'Dave', pos: 1 },
      { p: 'Alice', pos: 2 },
      { p: 'Bob', pos: 3 },
      { p: 'Charlie', pos: 4 },
    ],
  },
  {
    label: 'R8',
    type: 'completed',
    r: [
      { p: 'Charlie', pos: 1 },
      { p: 'Bob', pos: 2 },
      { p: 'Alice', pos: 3 },
      { p: 'Dave', pos: 4 },
    ],
  },
  {
    label: 'R9',
    type: 'completed',
    r: [
      { p: 'Alice', pos: 1 },
      { p: 'Dave', pos: 2 },
      { p: 'Bob', pos: 3 },
      { p: 'Charlie', pos: 4 },
    ],
  },
  {
    label: 'R10',
    type: 'completed',
    r: [
      { p: 'Bob', pos: 1 },
      { p: 'Charlie', pos: 2 },
      { p: 'Dave', pos: 3 },
      { p: 'Alice', pos: 4 },
    ],
  },
  {
    label: 'R11',
    type: 'completed',
    r: [
      { p: 'Charlie', pos: 1 },
      { p: 'Alice', pos: 2 },
      { p: 'Dave', pos: 3 },
      { p: 'Bob', pos: 4 },
    ],
  },
  {
    label: 'R12',
    type: 'completed',
    r: [
      { p: 'Dave', pos: 1 },
      { p: 'Bob', pos: 2 },
      { p: 'Charlie', pos: 3 },
      { p: 'Alice', pos: 4 },
    ],
  },
  {
    label: 'R13',
    type: 'completed',
    r: [
      { p: 'Alice', pos: 1 },
      { p: 'Bob', pos: 2 },
      { p: 'Dave', pos: 3 },
      { p: 'Charlie', pos: 4 },
    ],
  },
  {
    label: 'R14',
    type: 'completed',
    r: [
      { p: 'Bob', pos: 1 },
      { p: 'Alice', pos: 2 },
      { p: 'Charlie', pos: 3 },
      { p: 'Dave', pos: 4 },
    ],
  },
  {
    label: 'R15',
    type: 'completed',
    r: [
      { p: 'Charlie', pos: 1 },
      { p: 'Dave', pos: 2 },
      { p: 'Bob', pos: 3 },
      { p: 'Alice', pos: 4 },
    ],
  },
  {
    label: 'R16',
    type: 'completed',
    r: [
      { p: 'Dave', pos: 1 },
      { p: 'Charlie', pos: 2 },
      { p: 'Alice', pos: 3 },
      { p: 'Bob', pos: 4 },
    ],
  },
  {
    label: 'R17',
    type: 'completed',
    r: [
      { p: 'Alice', pos: 1 },
      { p: 'Dave', pos: 2 },
      { p: 'Charlie', pos: 3 },
      { p: 'Bob', pos: 4 },
    ],
  },
  {
    label: 'R18',
    type: 'completed',
    r: [
      { p: 'Bob', pos: 1 },
      { p: 'Charlie', pos: 2 },
      { p: 'Alice', pos: 3 },
      { p: 'Dave', pos: 4 },
    ],
  },
  {
    label: 'R19',
    type: 'completed',
    r: [
      { p: 'Charlie', pos: 1 },
      { p: 'Bob', pos: 2 },
      { p: 'Dave', pos: 3 },
      { p: 'Alice', pos: 4 },
    ],
  },
  {
    label: 'R20',
    type: 'completed',
    r: [
      { p: 'Dave', pos: 1 },
      { p: 'Alice', pos: 2 },
      { p: 'Bob', pos: 3 },
      { p: 'Charlie', pos: 4 },
    ],
  },
  {
    label: 'R21',
    type: 'completed',
    r: [
      { p: 'Alice', pos: 1 },
      { p: 'Charlie', pos: 2 },
      { p: 'Bob', pos: 3 },
      { p: 'Dave', pos: 4 },
    ],
  },
  {
    label: 'R22',
    type: 'completed',
    r: [
      { p: 'Bob', pos: 1 },
      { p: 'Dave', pos: 2 },
      { p: 'Alice', pos: 3 },
      { p: 'Charlie', pos: 4 },
    ],
  },
  {
    label: 'R23',
    type: 'completed',
    r: [
      { p: 'Charlie', pos: 1 },
      { p: 'Alice', pos: 2 },
      { p: 'Bob', pos: 3 },
      { p: 'Dave', pos: 4 },
    ],
  },
  {
    label: 'R24',
    type: 'completed',
    r: [
      { p: 'Dave', pos: 1 },
      { p: 'Bob', pos: 2 },
      { p: 'Charlie', pos: 3 },
      { p: 'Alice', pos: 4 },
    ],
  },
  {
    label: 'R25',
    type: 'completed',
    r: [
      { p: 'Alice', pos: 1 },
      { p: 'Bob', pos: 2 },
      { p: 'Charlie', pos: 3 },
      { p: 'Dave', pos: 4 },
    ],
  },
  {
    label: 'R26',
    type: 'completed',
    r: [
      { p: 'Bob', pos: 1 },
      { p: 'Alice', pos: 2 },
      { p: 'Dave', pos: 3 },
      { p: 'Charlie', pos: 4 },
    ],
  },
  {
    label: 'R27',
    type: 'completed',
    r: [
      { p: 'Charlie', pos: 1 },
      { p: 'Dave', pos: 2 },
      { p: 'Bob', pos: 3 },
      { p: 'Alice', pos: 4 },
    ],
  },
  {
    label: 'R28',
    type: 'completed',
    r: [
      { p: 'Dave', pos: 1 },
      { p: 'Charlie', pos: 2 },
      { p: 'Alice', pos: 3 },
      { p: 'Bob', pos: 4 },
    ],
  },
  {
    label: 'R29',
    type: 'completed',
    r: [
      { p: 'Alice', pos: 1 },
      { p: 'Dave', pos: 2 },
      { p: 'Charlie', pos: 3 },
      { p: 'Bob', pos: 4 },
    ],
  },
  {
    label: 'R30',
    type: 'completed',
    r: [
      { p: 'Bob', pos: 1 },
      { p: 'Alice', pos: 2 },
      { p: 'Charlie', pos: 3 },
      { p: 'Dave', pos: 4 },
    ],
  },
  // ── 5 VOIDED ─────────────────────────────────────────────────────────────
  { label: 'RV1', type: 'voided' },
  { label: 'RV2', type: 'voided' },
  { label: 'RV3', type: 'voided' },
  { label: 'RV4', type: 'voided' },
  { label: 'RV5', type: 'voided' },
  // ── 5 ABANDONED (one player per game abandons — assigned pos=4 for ELO) ──
  {
    label: 'RA1',
    type: 'abandoned',
    abandoner: 'Alice',
    r: [
      { p: 'Bob', pos: 1 },
      { p: 'Charlie', pos: 2 },
      { p: 'Dave', pos: 3 },
      { p: 'Alice', pos: 4 },
    ],
  },
  {
    label: 'RA2',
    type: 'abandoned',
    abandoner: 'Bob',
    r: [
      { p: 'Charlie', pos: 1 },
      { p: 'Dave', pos: 2 },
      { p: 'Alice', pos: 3 },
      { p: 'Bob', pos: 4 },
    ],
  },
  {
    label: 'RA3',
    type: 'abandoned',
    abandoner: 'Charlie',
    r: [
      { p: 'Dave', pos: 1 },
      { p: 'Alice', pos: 2 },
      { p: 'Bob', pos: 3 },
      { p: 'Charlie', pos: 4 },
    ],
  },
  {
    label: 'RA4',
    type: 'abandoned',
    abandoner: 'Dave',
    r: [
      { p: 'Alice', pos: 1 },
      { p: 'Bob', pos: 2 },
      { p: 'Charlie', pos: 3 },
      { p: 'Dave', pos: 4 },
    ],
  },
  {
    label: 'RA5',
    type: 'abandoned',
    abandoner: 'Alice',
    r: [
      { p: 'Dave', pos: 1 },
      { p: 'Charlie', pos: 2 },
      { p: 'Bob', pos: 3 },
      { p: 'Alice', pos: 4 },
    ],
  },
];

// ─── Ranked simulation ──────────────────────────────────────────────────────

interface RankedSnap {
  delta: State;
  state: State;
}

function runRankedSim(): RankedSnap[] {
  let s: State = { Alice: 1000, Bob: 1000, Charlie: 1000, Dave: 1000 };
  return RANKED_GAMES.map(g => {
    const delta: State = { Alice: 0, Bob: 0, Charlie: 0, Dave: 0 };
    if (g.type !== 'voided') {
      const inputs = g.r!.map(e => ({ player: e.p, pos: e.pos, r: s[e.p] }));
      const d = computeEloDelta(inputs);
      d.forEach((v, k) => {
        delta[k] = v;
      });
    }
    const next = applyFloor({
      Alice: s.Alice + delta.Alice,
      Bob: s.Bob + delta.Bob,
      Charlie: s.Charlie + delta.Charlie,
      Dave: s.Dave + delta.Dave,
    });
    s = next;
    return { delta: { ...delta }, state: { ...next } };
  });
}

const RS = runRankedSim();

// ============================================================================
// CASUAL TESTS
// ============================================================================

describe('Casual rank points — 40 games (30 completed, 5 voided, 5 abandoned)', () => {
  it('score=0   → delta +100  (winner gains maximum points)', () => {
    expect(casualDelta(0, 'completed')).toBe(100);
  });
  it('score=100 → delta 0     (break-even; no gain or loss)', () => {
    expect(casualDelta(100, 'completed')).toBe(0);
  });
  it('score=101 → delta −1    (just above break-even → negative)', () => {
    expect(casualDelta(101, 'completed')).toBe(-1);
  });
  it('score=200 → delta −100  (extreme loss — no cap in formula)', () => {
    expect(casualDelta(200, 'completed')).toBe(-100);
  });
  it('abandoned → delta always −25 regardless of score', () => {
    expect(casualDelta(0, 'abandoned')).toBe(-25);
    expect(casualDelta(50, 'abandoned')).toBe(-25);
    expect(casualDelta(200, 'abandoned')).toBe(-25);
  });
  it('voided → delta 0 regardless of score', () => {
    expect(casualDelta(0, 'voided')).toBe(0);
    expect(casualDelta(150, 'voided')).toBe(0);
  });

  it('C1: Dave score=110 → negative delta −10 (101+ rule demonstrated)', () => {
    expect(CS[0].delta).toEqual({ Alice: 100, Bob: 75, Charlie: 55, Dave: -10 });
    expect(CS[0].state).toEqual({ Alice: 1100, Bob: 1075, Charlie: 1055, Dave: 990 });
  });

  it('C2: Charlie score=120 → delta −20', () => {
    expect(CS[1].delta).toEqual({ Bob: 100, Alice: 70, Dave: 50, Charlie: -20 });
    expect(CS[1].state).toEqual({ Alice: 1170, Bob: 1175, Charlie: 1035, Dave: 1040 });
  });

  it('C3: Bob score=105 → delta −5', () => {
    expect(CS[2].delta).toEqual({ Charlie: 100, Dave: 82, Alice: 65, Bob: -5 });
    expect(CS[2].state).toEqual({ Alice: 1235, Bob: 1170, Charlie: 1135, Dave: 1122 });
  });

  it('C4: Alice score=115 → delta −15', () => {
    expect(CS[3].delta).toEqual({ Dave: 100, Charlie: 78, Bob: 45, Alice: -15 });
    expect(CS[3].state).toEqual({ Alice: 1220, Bob: 1215, Charlie: 1213, Dave: 1222 });
  });

  it('C5: Charlie(110)→−10 AND Dave(130)→−30 (TWO players above 100 in same game)', () => {
    expect(CS[4].delta).toEqual({ Alice: 100, Bob: 92, Charlie: -10, Dave: -30 });
    expect(CS[4].state).toEqual({ Alice: 1320, Bob: 1307, Charlie: 1203, Dave: 1192 });
  });

  it('C6: Alice(102)→−2 AND Charlie(145)→−45 (two more 101+ players)', () => {
    expect(CS[5].delta).toEqual({ Bob: 100, Dave: 88, Alice: -2, Charlie: -45 });
    expect(CS[5].state).toEqual({ Alice: 1318, Bob: 1407, Charlie: 1158, Dave: 1280 });
  });

  it('C7: Bob score=160 → delta −60', () => {
    expect(CS[6].delta).toEqual({ Charlie: 100, Alice: 95, Dave: 80, Bob: -60 });
    expect(CS[6].state).toEqual({ Alice: 1413, Bob: 1347, Charlie: 1258, Dave: 1360 });
  });

  it('C8: Charlie score=180 → delta −80', () => {
    expect(CS[7].delta).toEqual({ Dave: 100, Bob: 85, Alice: 75, Charlie: -80 });
    expect(CS[7].state).toEqual({ Alice: 1488, Bob: 1432, Charlie: 1178, Dave: 1460 });
  });

  it('C9: Dave score=200 → delta −100 (extreme; still valid — no cap on loss)', () => {
    expect(CS[8].delta).toEqual({ Alice: 100, Charlie: 90, Bob: 60, Dave: -100 });
    expect(CS[8].state).toEqual({ Alice: 1588, Bob: 1492, Charlie: 1268, Dave: 1360 });
  });

  it('C10: all scores ≤ 100 → all deltas positive', () => {
    expect(CS[9].delta).toEqual({ Bob: 100, Alice: 80, Charlie: 70, Dave: 5 });
    expect(CS[9].state).toEqual({ Alice: 1668, Bob: 1592, Charlie: 1338, Dave: 1365 });
  });

  it('C11: all positive', () => {
    expect(CS[10].delta).toEqual({ Charlie: 100, Dave: 92, Bob: 88, Alice: 25 });
    expect(CS[10].state).toEqual({ Alice: 1693, Bob: 1680, Charlie: 1438, Dave: 1457 });
  });

  it('C12: all positive', () => {
    expect(CS[11].delta).toEqual({ Dave: 100, Bob: 95, Alice: 82, Charlie: 12 });
    expect(CS[11].state).toEqual({ Alice: 1775, Bob: 1775, Charlie: 1450, Dave: 1557 });
  });

  it('C13: Bob score=99 → delta +1 (just below 100; score 100 = break-even)', () => {
    expect(CS[12].delta).toEqual({ Alice: 100, Dave: 86, Charlie: 78, Bob: 1 });
    expect(CS[12].state).toEqual({ Alice: 1875, Bob: 1776, Charlie: 1528, Dave: 1643 });
  });

  it('C14: Alice score=150 → delta −50', () => {
    expect(CS[13].delta).toEqual({ Bob: 100, Charlie: 94, Dave: 72, Alice: -50 });
    expect(CS[13].state).toEqual({ Alice: 1825, Bob: 1876, Charlie: 1622, Dave: 1715 });
  });

  it('C15: Dave score=125 → delta −25', () => {
    expect(CS[14].delta).toEqual({ Charlie: 100, Alice: 97, Bob: 84, Dave: -25 });
    expect(CS[14].state).toEqual({ Alice: 1922, Bob: 1960, Charlie: 1722, Dave: 1690 });
  });

  it('C16: Charlie score=108 → delta −8', () => {
    expect(CS[15].delta).toEqual({ Dave: 100, Alice: 91, Bob: 56, Charlie: -8 });
    expect(CS[15].state).toEqual({ Alice: 2013, Bob: 2016, Charlie: 1714, Dave: 1790 });
  });

  it('C17: Charlie score=140 → delta −40', () => {
    expect(CS[16].delta).toEqual({ Alice: 100, Bob: 89, Dave: 67, Charlie: -40 });
    expect(CS[16].state).toEqual({ Alice: 2113, Bob: 2105, Charlie: 1674, Dave: 1857 });
  });

  it('C18: Charlie score=112 → delta −12', () => {
    expect(CS[17].delta).toEqual({ Bob: 100, Dave: 98, Alice: 81, Charlie: -12 });
    expect(CS[17].state).toEqual({ Alice: 2194, Bob: 2205, Charlie: 1662, Dave: 1955 });
  });

  it('C19: Alice score=155 → delta −55', () => {
    expect(CS[18].delta).toEqual({ Charlie: 100, Bob: 93, Dave: 76, Alice: -55 });
    expect(CS[18].state).toEqual({ Alice: 2139, Bob: 2298, Charlie: 1762, Dave: 2031 });
  });

  it('C20: Bob score=175 → delta −75', () => {
    expect(CS[19].delta).toEqual({ Dave: 100, Alice: 87, Charlie: 64, Bob: -75 });
    expect(CS[19].state).toEqual({ Alice: 2226, Bob: 2223, Charlie: 1826, Dave: 2131 });
  });

  it('C21: all scores ≤ 100 → all deltas positive', () => {
    expect(CS[20].delta).toEqual({ Alice: 100, Charlie: 85, Bob: 58, Dave: 15 });
    expect(CS[20].state).toEqual({ Alice: 2326, Bob: 2281, Charlie: 1911, Dave: 2146 });
  });

  it('C22: all positive', () => {
    expect(CS[21].delta).toEqual({ Bob: 100, Dave: 96, Charlie: 72, Alice: 10 });
    expect(CS[21].state).toEqual({ Alice: 2336, Bob: 2381, Charlie: 1983, Dave: 2242 });
  });

  it('C23: all positive', () => {
    expect(CS[22].delta).toEqual({ Charlie: 100, Alice: 89, Dave: 62, Bob: 22 });
    expect(CS[22].state).toEqual({ Alice: 2425, Bob: 2403, Charlie: 2083, Dave: 2304 });
  });

  it('C24: all positive', () => {
    expect(CS[23].delta).toEqual({ Dave: 100, Bob: 91, Alice: 79, Charlie: 8 });
    expect(CS[23].state).toEqual({ Alice: 2504, Bob: 2494, Charlie: 2091, Dave: 2404 });
  });

  it('C25: Dave score=102 → delta −2 (barely negative; score 101 would be −1)', () => {
    expect(CS[24].delta).toEqual({ Alice: 100, Bob: 83, Charlie: 66, Dave: -2 });
    expect(CS[24].state).toEqual({ Alice: 2604, Bob: 2577, Charlie: 2157, Dave: 2402 });
  });

  it('C26: Charlie score=118 → delta −18', () => {
    expect(CS[25].delta).toEqual({ Bob: 100, Alice: 94, Dave: 85, Charlie: -18 });
    expect(CS[25].state).toEqual({ Alice: 2698, Bob: 2677, Charlie: 2139, Dave: 2487 });
  });

  it('C27: Alice score=135 → delta −35', () => {
    expect(CS[26].delta).toEqual({ Charlie: 100, Dave: 97, Bob: 71, Alice: -35 });
    expect(CS[26].state).toEqual({ Alice: 2663, Bob: 2748, Charlie: 2239, Dave: 2584 });
  });

  it('C28: Bob score=145 → delta −45', () => {
    expect(CS[27].delta).toEqual({ Dave: 100, Charlie: 89, Alice: 77, Bob: -45 });
    expect(CS[27].state).toEqual({ Alice: 2740, Bob: 2703, Charlie: 2328, Dave: 2684 });
  });

  it('C29: Bob score=190 → delta −90', () => {
    expect(CS[28].delta).toEqual({ Alice: 100, Charlie: 92, Dave: 74, Bob: -90 });
    expect(CS[28].state).toEqual({ Alice: 2840, Bob: 2613, Charlie: 2420, Dave: 2758 });
  });

  it('C30: Charlie score=210 → delta −110 (extreme; formula: 100−210=−110, no cap)', () => {
    expect(CS[29].delta).toEqual({ Bob: 100, Alice: 86, Dave: 68, Charlie: -110 });
    expect(CS[29].state).toEqual({ Alice: 2926, Bob: 2713, Charlie: 2310, Dave: 2826 });
  });

  it('CV1–CV5: voided games — all deltas 0, all totals frozen at post-C30 state', () => {
    for (let i = 30; i <= 34; i++) {
      expect(CS[i].delta).toEqual({ Alice: 0, Bob: 0, Charlie: 0, Dave: 0 });
      expect(CS[i].state).toEqual({ Alice: 2926, Bob: 2713, Charlie: 2310, Dave: 2826 });
    }
  });

  it('CA1: all players −25 each (first abandoned game)', () => {
    expect(CS[35].delta).toEqual({ Alice: -25, Bob: -25, Charlie: -25, Dave: -25 });
    expect(CS[35].state).toEqual({ Alice: 2901, Bob: 2688, Charlie: 2285, Dave: 2801 });
  });

  it('CA2: all players −25 (second abandoned game)', () => {
    expect(CS[36].delta).toEqual({ Alice: -25, Bob: -25, Charlie: -25, Dave: -25 });
    expect(CS[36].state).toEqual({ Alice: 2876, Bob: 2663, Charlie: 2260, Dave: 2776 });
  });

  it('CA3: all players −25', () => {
    expect(CS[37].delta).toEqual({ Alice: -25, Bob: -25, Charlie: -25, Dave: -25 });
    expect(CS[37].state).toEqual({ Alice: 2851, Bob: 2638, Charlie: 2235, Dave: 2751 });
  });

  it('CA4: all players −25', () => {
    expect(CS[38].delta).toEqual({ Alice: -25, Bob: -25, Charlie: -25, Dave: -25 });
    expect(CS[38].state).toEqual({ Alice: 2826, Bob: 2613, Charlie: 2210, Dave: 2726 });
  });

  it('CA5: all players −25 (total casual drain from 5 abandoned = −125 each)', () => {
    expect(CS[39].delta).toEqual({ Alice: -25, Bob: -25, Charlie: -25, Dave: -25 });
    expect(CS[39].state).toEqual({ Alice: 2801, Bob: 2588, Charlie: 2185, Dave: 2701 });
  });

  it('final state: Alice=2801 Bob=2588 Charlie=2185 Dave=2701', () => {
    expect(CS[39].state).toEqual({ Alice: 2801, Bob: 2588, Charlie: 2185, Dave: 2701 });
  });

  it('22 of 30 completed games have at least one player with score > 100', () => {
    const count = (CASUAL_GAMES.slice(0, 30) as CasualGame[]).filter(g =>
      g.r!.some(r => r.s > 100)
    ).length;
    expect(count).toBe(22);
  });

  it('winner of every completed game (score=0) receives delta=+100', () => {
    CASUAL_GAMES.slice(0, 30).forEach((g, i) => {
      const winner = g.r!.find(r => r.s === 0)!;
      expect(CS[i].delta[winner.p]).toBe(100);
    });
  });

  it('score 101+ always produces negative delta (no cap)', () => {
    CASUAL_GAMES.slice(0, 30).forEach((g, i) => {
      g.r!.forEach(res => {
        if (res.s > 100) expect(CS[i].delta[res.p]).toBeLessThan(0);
      });
    });
  });

  it('all states stay ≥ 0 (floor applied)', () => {
    CS.forEach(snap => PLAYERS.forEach(p => expect(snap.state[p]).toBeGreaterThanOrEqual(0)));
  });

  it('5 voided games contribute exactly 0 to each player', () => {
    expect(CS[29].state).toEqual(CS[34].state);
  });

  it('5 abandoned games deduct exactly −125 total per player', () => {
    const before = CS[34].state;
    const after = CS[39].state;
    PLAYERS.forEach(p => expect(after[p]).toBe(before[p] - 125));
  });

  it('prints full casual simulation table', () => {
    print('\n══ CASUAL RANK POINTS (40 games) ═══════════════════════════════════');
    print(
      'Score shown per player. Score 101+ => NEGATIVE delta (no cap). Abandoned=−25 fixed. Voided=no change.\n'
    );
    const hdr = [
      'Game  ',
      'Type      ',
      ' Alice Sc',
      ' Alice Δ',
      ' Bob Sc',
      ' Bob Δ',
      ' Charlie Sc',
      ' Charlie Δ',
      ' Dave Sc',
      ' Dave Δ',
      '  │',
      ' Alice RP',
      '  Bob RP',
      ' Charlie RP',
      ' Dave RP',
    ].join('');
    print(hdr);
    print('─'.repeat(hdr.length));

    CASUAL_GAMES.forEach((g, i) => {
      const { delta: d, state: s } = CS[i];
      const fmt = (n: number) => (n > 0 ? '+' + n : String(n));
      const sc: Record<string, string> = {};
      PLAYERS.forEach(p => {
        if (g.type === 'voided') sc[p] = 'VOID';
        else if (g.type === 'abandoned') sc[p] = 'ABN';
        else sc[p] = String(g.r!.find(r => r.p === p)!.s);
      });
      print(
        g.label.padEnd(6),
        g.type.padEnd(10),
        sc.Alice.padStart(9),
        fmt(d.Alice).padStart(8),
        sc.Bob.padStart(7),
        fmt(d.Bob).padStart(6),
        sc.Charlie.padStart(11),
        fmt(d.Charlie).padStart(10),
        sc.Dave.padStart(8),
        fmt(d.Dave).padStart(8),
        '  │',
        String(s.Alice).padStart(9),
        String(s.Bob).padStart(8),
        String(s.Charlie).padStart(11),
        String(s.Dave).padStart(9)
      );
    });
    const fin = CS[39].state;
    print('─'.repeat(hdr.length));
    print(`FINAL  Alice=${fin.Alice}  Bob=${fin.Bob}  Charlie=${fin.Charlie}  Dave=${fin.Dave}`);
    expect(true).toBe(true);
  });
});

// ============================================================================
// RANKED TESTS
// ============================================================================

describe('Ranked rank points (K=32 ELO) — 40 games (30 completed, 5 voided, 5 abandoned)', () => {
  it('equal ratings → win delta = ROUND(32×0.5) = 16', () => {
    const d = computeEloDelta([
      { player: 'A', pos: 1, r: 1000 },
      { player: 'B', pos: 2, r: 1000 },
    ]);
    expect(d.get('A')).toBe(16);
    expect(d.get('B')).toBe(-16);
  });

  it('4-player ELO is zero-sum across all 6 pairs', () => {
    const d = computeEloDelta([
      { player: 'A', pos: 1, r: 1000 },
      { player: 'B', pos: 2, r: 1000 },
      { player: 'C', pos: 3, r: 1000 },
      { player: 'D', pos: 4, r: 1000 },
    ]);
    expect([...d.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('R1: Alice 1st, Bob 2nd, Charlie 3rd, Dave 4th (all equal 1000)', () => {
    expect(RS[0].delta).toEqual({ Alice: 48, Bob: 16, Charlie: -16, Dave: -48 });
    expect(RS[0].state).toEqual({ Alice: 1048, Bob: 1016, Charlie: 984, Dave: 952 });
  });

  it('R2: Dave wins — Alice last', () => {
    expect(RS[1].delta).toEqual({ Dave: 56, Charlie: 19, Bob: -19, Alice: -56 });
    expect(RS[1].state).toEqual({ Alice: 992, Bob: 997, Charlie: 1003, Dave: 1008 });
  });

  it('R3: Bob wins', () => {
    expect(RS[2].delta).toEqual({ Bob: 49, Alice: 18, Dave: -18, Charlie: -49 });
    expect(RS[2].state).toEqual({ Alice: 1010, Bob: 1046, Charlie: 954, Dave: 990 });
  });

  it('R4: Charlie wins', () => {
    expect(RS[3].delta).toEqual({ Charlie: 57, Dave: 18, Alice: -18, Bob: -57 });
    expect(RS[3].state).toEqual({ Alice: 992, Bob: 989, Charlie: 1011, Dave: 1008 });
  });

  it('R5: Alice wins — Bob last', () => {
    expect(RS[4].delta).toEqual({ Alice: 50, Charlie: 14, Dave: -18, Bob: -46 });
    expect(RS[4].state).toEqual({ Alice: 1042, Bob: 943, Charlie: 1025, Dave: 990 });
  });

  it('R6: Bob wins — Alice last', () => {
    expect(RS[5].delta).toEqual({ Bob: 58, Dave: 18, Charlie: -21, Alice: -55 });
    expect(RS[5].state).toEqual({ Alice: 987, Bob: 1001, Charlie: 1004, Dave: 1008 });
  });

  it('R7: Dave wins — Charlie last', () => {
    expect(RS[6].delta).toEqual({ Dave: 47, Alice: 19, Bob: -17, Charlie: -49 });
    expect(RS[6].state).toEqual({ Alice: 1006, Bob: 984, Charlie: 955, Dave: 1055 });
  });

  it('R8: Charlie wins — Dave last', () => {
    expect(RS[7].delta).toEqual({ Charlie: 55, Bob: 19, Alice: -17, Dave: -57 });
    expect(RS[7].state).toEqual({ Alice: 989, Bob: 1003, Charlie: 1010, Dave: 998 });
  });

  it('R9: Alice wins — Charlie last', () => {
    expect(RS[8].delta).toEqual({ Alice: 50, Dave: 17, Bob: -17, Charlie: -50 });
    expect(RS[8].state).toEqual({ Alice: 1039, Bob: 986, Charlie: 960, Dave: 1015 });
  });

  it('R10: Bob wins — Alice last', () => {
    expect(RS[9].delta).toEqual({ Bob: 50, Charlie: 24, Dave: -19, Alice: -55 });
    expect(RS[9].state).toEqual({ Alice: 984, Bob: 1036, Charlie: 984, Dave: 996 });
  });

  it('R11: Charlie wins — Bob last', () => {
    expect(RS[10].delta).toEqual({ Charlie: 51, Alice: 19, Dave: -16, Bob: -54 });
    expect(RS[10].state).toEqual({ Alice: 1003, Bob: 982, Charlie: 1035, Dave: 980 });
  });

  it('R12: Dave wins — Alice last', () => {
    expect(RS[11].delta).toEqual({ Dave: 52, Bob: 19, Charlie: -22, Alice: -49 });
    expect(RS[11].state).toEqual({ Alice: 954, Bob: 1001, Charlie: 1013, Dave: 1032 });
  });

  it('R13: Alice wins — Charlie last', () => {
    expect(RS[12].delta).toEqual({ Alice: 57, Bob: 16, Dave: -22, Charlie: -51 });
    expect(RS[12].state).toEqual({ Alice: 1011, Bob: 1017, Charlie: 962, Dave: 1010 });
  });

  it('R14: Bob wins — Dave last', () => {
    expect(RS[13].delta).toEqual({ Bob: 45, Alice: 14, Charlie: -9, Dave: -50 });
    expect(RS[13].state).toEqual({ Alice: 1025, Bob: 1062, Charlie: 953, Dave: 960 });
  });

  it('R15: Charlie wins — Alice last', () => {
    expect(RS[14].delta).toEqual({ Charlie: 56, Dave: 24, Bob: -28, Alice: -52 });
    expect(RS[14].state).toEqual({ Alice: 973, Bob: 1034, Charlie: 1009, Dave: 984 });
  });

  it('R16: Dave wins — Bob last', () => {
    expect(RS[15].delta).toEqual({ Dave: 50, Charlie: 14, Alice: -10, Bob: -54 });
    expect(RS[15].state).toEqual({ Alice: 963, Bob: 980, Charlie: 1023, Dave: 1034 });
  });

  it('R17: Alice wins — Bob last', () => {
    expect(RS[16].delta).toEqual({ Alice: 55, Dave: 10, Charlie: -20, Bob: -45 });
    expect(RS[16].state).toEqual({ Alice: 1018, Bob: 935, Charlie: 1003, Dave: 1044 });
  });

  it('R18: Bob wins — Dave last', () => {
    expect(RS[17].delta).toEqual({ Bob: 60, Charlie: 16, Alice: -20, Dave: -56 });
    expect(RS[17].state).toEqual({ Alice: 998, Bob: 995, Charlie: 1019, Dave: 988 });
  });

  it('R19: Charlie wins — Alice last', () => {
    expect(RS[18].delta).toEqual({ Charlie: 45, Bob: 17, Dave: -15, Alice: -47 });
    expect(RS[18].state).toEqual({ Alice: 951, Bob: 1012, Charlie: 1064, Dave: 973 });
  });

  it('R20: Dave wins — Charlie last', () => {
    expect(RS[19].delta).toEqual({ Dave: 53, Alice: 25, Bob: -19, Charlie: -59 });
    expect(RS[19].state).toEqual({ Alice: 976, Bob: 993, Charlie: 1005, Dave: 1026 });
  });

  it('R21: Alice wins — Dave last', () => {
    expect(RS[20].delta).toEqual({ Alice: 52, Charlie: 15, Bob: -14, Dave: -53 });
    expect(RS[20].state).toEqual({ Alice: 1028, Bob: 979, Charlie: 1020, Dave: 973 });
  });

  it('R22: Bob wins — Charlie last', () => {
    expect(RS[21].delta).toEqual({ Bob: 52, Dave: 21, Alice: -21, Charlie: -52 });
    expect(RS[21].state).toEqual({ Alice: 1007, Bob: 1031, Charlie: 968, Dave: 994 });
  });

  it('R23: Charlie wins — Dave last', () => {
    expect(RS[22].delta).toEqual({ Charlie: 54, Alice: 14, Bob: -22, Dave: -46 });
    expect(RS[22].state).toEqual({ Alice: 1021, Bob: 1009, Charlie: 1022, Dave: 948 });
  });

  it('R24: Dave wins — Alice last', () => {
    expect(RS[23].delta).toEqual({ Dave: 57, Bob: 15, Charlie: -20, Alice: -52 });
    expect(RS[23].state).toEqual({ Alice: 969, Bob: 1024, Charlie: 1002, Dave: 1005 });
  });

  it('R25: Alice wins — Dave last', () => {
    expect(RS[24].delta).toEqual({ Alice: 55, Bob: 11, Charlie: -17, Dave: -49 });
    expect(RS[24].state).toEqual({ Alice: 1024, Bob: 1035, Charlie: 985, Dave: 956 });
  });

  it('R26: Bob wins — Charlie last', () => {
    expect(RS[25].delta).toEqual({ Bob: 41, Alice: 12, Dave: -8, Charlie: -45 });
    expect(RS[25].state).toEqual({ Alice: 1036, Bob: 1076, Charlie: 940, Dave: 948 });
  });

  it('R27: Charlie wins — Alice last', () => {
    expect(RS[26].delta).toEqual({ Charlie: 58, Dave: 26, Bob: -30, Alice: -54 });
    expect(RS[26].state).toEqual({ Alice: 982, Bob: 1046, Charlie: 998, Dave: 974 });
  });

  it('R28: Dave wins — Bob last', () => {
    expect(RS[27].delta).toEqual({ Dave: 52, Charlie: 16, Alice: -12, Bob: -56 });
    expect(RS[27].state).toEqual({ Alice: 970, Bob: 990, Charlie: 1014, Dave: 1026 });
  });

  it('R29: Alice wins — Bob last', () => {
    expect(RS[28].delta).toEqual({ Alice: 54, Dave: 10, Charlie: -18, Bob: -46 });
    expect(RS[28].state).toEqual({ Alice: 1024, Bob: 944, Charlie: 996, Dave: 1036 });
  });

  it('R30: Bob wins — Dave last', () => {
    expect(RS[29].delta).toEqual({ Bob: 58, Alice: 12, Charlie: -15, Dave: -55 });
    expect(RS[29].state).toEqual({ Alice: 1036, Bob: 1002, Charlie: 981, Dave: 981 });
  });

  it('RV1–RV5: voided — all ELO deltas 0, all ratings frozen at post-R30 state', () => {
    for (let i = 30; i <= 34; i++) {
      expect(RS[i].delta).toEqual({ Alice: 0, Bob: 0, Charlie: 0, Dave: 0 });
      expect(RS[i].state).toEqual({ Alice: 1036, Bob: 1002, Charlie: 981, Dave: 981 });
    }
  });

  it('RA1: Alice ABANDONS → pos=4; Bob 1st, Charlie 2nd, Dave 3rd — Alice loses most ELO (−56)', () => {
    expect(RS[35].delta.Alice).toBe(-56);
    expect(RS[35].delta.Bob).toBe(48);
    expect(RS[35].delta.Charlie).toBe(20);
    expect(RS[35].delta.Dave).toBe(-12);
    expect(RS[35].state).toEqual({ Alice: 980, Bob: 1050, Charlie: 1001, Dave: 969 });
  });

  it('RA2: Bob ABANDONS → pos=4; Charlie 1st, Dave 2nd, Alice 3rd — Bob loses −57', () => {
    expect(RS[36].delta.Bob).toBe(-57);
    expect(RS[36].delta.Charlie).toBe(48);
    expect(RS[36].delta.Dave).toBe(22);
    expect(RS[36].delta.Alice).toBe(-13);
    expect(RS[36].state).toEqual({ Alice: 967, Bob: 993, Charlie: 1049, Dave: 991 });
  });

  it('RA3: Charlie ABANDONS → pos=4; Dave 1st, Alice 2nd, Bob 3rd — Charlie loses −58', () => {
    expect(RS[37].delta.Charlie).toBe(-58);
    expect(RS[37].delta.Dave).toBe(50);
    expect(RS[37].delta.Alice).toBe(22);
    expect(RS[37].delta.Bob).toBe(-14);
    expect(RS[37].state).toEqual({ Alice: 989, Bob: 979, Charlie: 991, Dave: 1041 });
  });

  it('RA4: Dave ABANDONS → pos=4; Alice 1st, Bob 2nd, Charlie 3rd — Dave loses −55', () => {
    expect(RS[38].delta.Dave).toBe(-55);
    expect(RS[38].delta.Alice).toBe(50);
    expect(RS[38].delta.Bob).toBe(20);
    expect(RS[38].delta.Charlie).toBe(-15);
    expect(RS[38].state).toEqual({ Alice: 1039, Bob: 999, Charlie: 976, Dave: 986 });
  });

  it('RA5: Alice ABANDONS again → Dave 1st, Charlie 2nd, Bob 3rd — Alice loses −55 (second abandonment)', () => {
    expect(RS[39].delta.Alice).toBe(-55);
    expect(RS[39].delta.Dave).toBe(51);
    expect(RS[39].delta.Charlie).toBe(20);
    expect(RS[39].delta.Bob).toBe(-16);
    expect(RS[39].state).toEqual({ Alice: 984, Bob: 983, Charlie: 996, Dave: 1037 });
  });

  it('final ranked ELO: Alice=984 Bob=983 Charlie=996 Dave=1037', () => {
    expect(RS[39].state).toEqual({ Alice: 984, Bob: 983, Charlie: 996, Dave: 1037 });
  });

  it('all ranked states stay ≥ 0', () => {
    RS.forEach(snap => PLAYERS.forEach(p => expect(snap.state[p]).toBeGreaterThanOrEqual(0)));
  });

  it('voided games contribute 0 ELO to all players', () => {
    expect(RS[29].state).toEqual(RS[34].state);
  });

  it('abandoning player always loses more ELO than pos=2 or pos=3 in same game', () => {
    [35, 36, 37, 38, 39].forEach(i => {
      const g = RANKED_GAMES[i];
      const d = RS[i].delta;
      const abn = d[g.abandoner!];
      g.r!.filter(e => e.pos === 2 || e.pos === 3).forEach(e => {
        expect(abn).toBeLessThan(d[e.p]);
      });
    });
  });

  it('prints full ranked simulation table', () => {
    print(
      '\n══ RANKED RANK POINTS (40 games, K=32 ELO) ══════════════════════════════════════════════════'
    );
    print(
      'Abandoned player treated as pos=4 (last place) for ELO — causes maximum loss in that game.\n'
    );
    print(
      'Game  ',
      'Type      ',
      'Abandoner  ',
      ' A-Pos',
      ' A-Δ',
      ' B-Pos',
      ' B-Δ',
      ' C-Pos',
      ' C-Δ',
      ' D-Pos',
      ' D-Δ',
      '  │',
      ' Alice RP',
      '  Bob RP',
      ' Charlie RP',
      ' Dave RP'
    );
    print('─'.repeat(130));

    RANKED_GAMES.forEach((g, i) => {
      const { delta: d, state: s } = RS[i];
      const fmt = (n: number) => (n > 0 ? '+' + n : String(n));
      const posOf = (p: string) => {
        if (g.type === 'voided') return 'VOID';
        const e = g.r!.find(r => r.p === p)!;
        return g.type === 'abandoned' && p === g.abandoner ? 'ABN→4' : String(e.pos);
      };
      print(
        g.label.padEnd(6),
        g.type.padEnd(10),
        (g.abandoner ?? '—').padEnd(11),
        posOf('Alice').padStart(6),
        fmt(d.Alice).padStart(4),
        posOf('Bob').padStart(6),
        fmt(d.Bob).padStart(4),
        posOf('Charlie').padStart(6),
        fmt(d.Charlie).padStart(4),
        posOf('Dave').padStart(6),
        fmt(d.Dave).padStart(4),
        '  │',
        String(s.Alice).padStart(9),
        String(s.Bob).padStart(8),
        String(s.Charlie).padStart(11),
        String(s.Dave).padStart(9)
      );
    });
    const fin = RS[39].state;
    print('─'.repeat(130));
    print(`FINAL  Alice=${fin.Alice}  Bob=${fin.Bob}  Charlie=${fin.Charlie}  Dave=${fin.Dave}`);
    expect(true).toBe(true);
  });

  it('writes rank-points MD report with score and abandonment sections', () => {
    const lines: string[] = [];
    const L = (s = '') => lines.push(s);

    L('# 4-Player Rank Points Simulation — Results');
    L();
    L('> **Generated by:** `rank-points-4player.test.ts` (v3)  ');
    L(`> **Date:** ${new Date().toISOString().slice(0, 10)}`);
    L();
    L('## Formulas');
    L();
    L('### Casual Rank Points');
    L();
    L('```');
    L('delta = ROUND((100 - score) × bot_multiplier)   // NO cap');
    L('score 0      → +100 × mult  (winner)');
    L('score 1–99   → positive delta');
    L('score 100    → 0  (break-even)');
    L('score 101+   → NEGATIVE delta  ← key rule');
    L('abandoned    → −25 fixed (ignores score / multiplier)');
    L('voided       → 0 (game nullified)');
    L('floor        → none (rank points can go negative and recover)');
    L('```');
    L();
    L('### Ranked Rank Points (K=32 pairwise ELO)');
    L();
    L('```');
    L('For each unique pair (i,j) where pos_i < pos_j:');
    L('  expected = 1 / (1 + 10^((loser_r − winner_r) / 400))');
    L('  winner  += ROUND(32 × (1 − expected))');
    L('  loser   −= same amount  (zero-sum per pair)');
    L('voided    → 0 ELO change');
    L('abandoned → abandoning player assigned pos=4 (last place) for ELO');
    L('floor     → none (rank points can go negative and recover)');
    L('```');
    L();
    L('---');
    L();
    L('## Casual Rank Points — 40 games');
    L();
    L('> All start at **1000**. bot_multiplier = 1.0.  ');
    L('> **Bold score**: player held ≥ 101 cards-value (→ negative delta).  ');
    L('> ABN = abandoned (−25 fixed). VOID = voided (0).');
    L();
    L(
      '| Game | Type | Alice Score | Alice Δ | Bob Score | Bob Δ | Charlie Score | Charlie Δ | Dave Score | Dave Δ | Alice RP | Bob RP | Charlie RP | Dave RP |'
    );
    L(
      '|------|------|:-----------:|:-------:|:---------:|:-----:|:-------------:|:---------:|:----------:|:------:|:--------:|:------:|:----------:|:-------:|'
    );

    CASUAL_GAMES.forEach((g, i) => {
      const { delta: d, state: s } = CS[i];
      const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));
      const sc: Record<string, string> = {};
      PLAYERS.forEach(p => {
        if (g.type === 'voided') sc[p] = 'VOID';
        else if (g.type === 'abandoned') sc[p] = 'ABN';
        else sc[p] = String(g.r!.find(r => r.p === p)!.s);
      });
      const neg = (p: string) => (d[p] < 0 ? `**${fmt(d[p])}**` : fmt(d[p]));
      const hi = (p: string) => {
        const v = Number(sc[p]);
        return !isNaN(v) && v > 100 ? `**${sc[p]}**` : sc[p];
      };
      lines.push(
        `| ${g.label} | ${g.type} | ${hi('Alice')} | ${neg('Alice')} | ${hi('Bob')} | ${neg('Bob')} | ${hi('Charlie')} | ${neg('Charlie')} | ${hi('Dave')} | ${neg('Dave')} | ${s.Alice} | ${s.Bob} | ${s.Charlie} | ${s.Dave} |`
      );
    });

    L();
    const cf = CS[39].state;
    L(
      `**Final:** Alice **${cf.Alice}** | Bob **${cf.Bob}** | Charlie **${cf.Charlie}** | Dave **${cf.Dave}**`
    );
    L();
    L('---');
    L();
    L('## Ranked Rank Points — K=32 ELO (40 games)');
    L();
    L('> All start at **1000**.  ');
    L('> **ABN→4**: player abandoned, treated as last place (pos=4) for ELO.  ');
    L('> **Bold Δ**: negative this game.');
    L();
    L(
      '| Game | Type | Abandoner | Alice Pos | Alice Δ | Bob Pos | Bob Δ | Charlie Pos | Charlie Δ | Dave Pos | Dave Δ | Alice RP | Bob RP | Charlie RP | Dave RP |'
    );
    L(
      '|------|------|:---------:|:---------:|:-------:|:-------:|:-----:|:-----------:|:---------:|:--------:|:------:|:--------:|:------:|:----------:|:-------:|'
    );

    RANKED_GAMES.forEach((g, i) => {
      const { delta: d, state: s } = RS[i];
      const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));
      const neg = (p: string) => (d[p] < 0 ? `**${fmt(d[p])}**` : fmt(d[p]));
      const posOf = (p: string): string => {
        if (g.type === 'voided') return 'VOID';
        const e = g.r!.find(r => r.p === p)!;
        return g.type === 'abandoned' && p === g.abandoner ? '**ABN→4**' : String(e.pos);
      };
      lines.push(
        `| ${g.label} | ${g.type} | ${g.abandoner ?? '—'} | ${posOf('Alice')} | ${neg('Alice')} | ${posOf('Bob')} | ${neg('Bob')} | ${posOf('Charlie')} | ${neg('Charlie')} | ${posOf('Dave')} | ${neg('Dave')} | ${s.Alice} | ${s.Bob} | ${s.Charlie} | ${s.Dave} |`
      );
    });

    L();
    const rf = RS[39].state;
    L(
      `**Final:** Alice **${rf.Alice}** | Bob **${rf.Bob}** | Charlie **${rf.Charlie}** | Dave **${rf.Dave}**`
    );
    L();
    L('---');
    L();
    L('## Abandonment — What Happens?');
    L();
    L('### Casual mode');
    L(
      'All 4 players receive **−25** fixed penalty. Score is irrelevant. 5 abandoned games = **−125 per player**.'
    );
    L();
    L('### Ranked mode');
    L(
      'The abandoner is assigned **pos=4 (last place)**. ELO computed normally across all 6 pairs.'
    );
    L('The abandoner loses the maximum ELO in the game (beaten by all 3 remaining players).');
    L();
    L('| Game | Abandoner | Abandoner Δ | 1st Δ | 2nd Δ | 3rd Δ |');
    L('|------|-----------|:-----------:|:-----:|:-----:|:-----:|');
    [35, 36, 37, 38, 39].forEach(i => {
      const g = RANKED_GAMES[i];
      const { delta: d } = RS[i];
      const p1 = g.r!.find(e => e.pos === 1)!.p;
      const p2 = g.r!.find(e => e.pos === 2)!.p;
      const p3 = g.r!.find(e => e.pos === 3)!.p;
      const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));
      lines.push(
        `| ${g.label} | **${g.abandoner}** | **${fmt(d[g.abandoner!])}** | ${fmt(d[p1])} | ${fmt(d[p2])} | ${fmt(d[p3])} |`
      );
    });
    L();
    L('---');
    L();
    L('## Win Distribution (completed games only)');
    L();
    const cWins: Record<string, number> = { Alice: 0, Bob: 0, Charlie: 0, Dave: 0 };
    CASUAL_GAMES.slice(0, 30).forEach(g => {
      cWins[(g as any).r.find((r: any) => r.s === 0).p]++;
    });
    const rWins: Record<string, number> = { Alice: 0, Bob: 0, Charlie: 0, Dave: 0 };
    RANKED_GAMES.slice(0, 30).forEach(g => {
      rWins[(g as any).r.find((r: any) => r.pos === 1).p]++;
    });
    L(
      '**Casual wins:** Alice ' +
        cWins.Alice +
        ' | Bob ' +
        cWins.Bob +
        ' | Charlie ' +
        cWins.Charlie +
        ' | Dave ' +
        cWins.Dave
    );
    L();
    L(
      '**Ranked 1st places:** Alice ' +
        rWins.Alice +
        ' | Bob ' +
        rWins.Bob +
        ' | Charlie ' +
        rWins.Charlie +
        ' | Dave ' +
        rWins.Dave
    );
    L();
    L('*End of report.*');

    const outDir = path.join(__dirname, '../../../../../docs/lebanese-poker/testing');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'RANK_POINTS_4PLAYER_TEST_RESULTS.md');
    fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
    print(`\nMD report written → ${outPath}`);
    expect(fs.existsSync(outPath)).toBe(true);
  });
});
