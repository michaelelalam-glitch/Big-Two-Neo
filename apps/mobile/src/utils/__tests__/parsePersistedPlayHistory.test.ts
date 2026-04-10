/**
 * parsePersistedPlayHistory Unit Tests
 *
 * Validates the play-history restore logic used by useGameStateManager on
 * local AI game rejoin (P4-5 fix). Covers all branches:
 * - null / undefined input → no-op
 * - invalid JSON → shouldRemove
 * - non-array JSON → shouldRemove
 * - empty array → no entries, no remove
 * - valid payload → entries returned
 * - missing matchNumber → shouldRemove
 * - non-number matchNumber → shouldRemove
 * - missing hands array → shouldRemove
 * - hands is not an array → shouldRemove
 * - extra optional fields are preserved
 */

import { parsePersistedPlayHistory } from '../parsePersistedPlayHistory';
import type { PlayHistoryMatch } from '../../types/scoreboard';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMatch(overrides: Partial<PlayHistoryMatch> = {}): PlayHistoryMatch {
  return {
    matchNumber: 1,
    hands: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parsePersistedPlayHistory', () => {
  describe('absent / null input', () => {
    it('returns null entries and shouldRemove=false for null', () => {
      const result = parsePersistedPlayHistory(null);
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(false);
    });

    it('returns null entries and shouldRemove=false for undefined', () => {
      const result = parsePersistedPlayHistory(undefined);
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(false);
    });
  });

  describe('invalid JSON', () => {
    it('returns null entries and shouldRemove=true for malformed JSON', () => {
      const result = parsePersistedPlayHistory('{invalid-json}');
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });

    it('returns null entries and shouldRemove=true for plain string', () => {
      const result = parsePersistedPlayHistory('not-json-at-all');
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });

    it('returns null entries and shouldRemove=true for empty string', () => {
      const result = parsePersistedPlayHistory('');
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });
  });

  describe('non-array JSON', () => {
    it('returns shouldRemove=true for JSON object', () => {
      const result = parsePersistedPlayHistory(JSON.stringify({ matchNumber: 1, hands: [] }));
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });

    it('returns shouldRemove=true for JSON number', () => {
      const result = parsePersistedPlayHistory(JSON.stringify(42));
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });

    it('returns shouldRemove=true for JSON null', () => {
      const result = parsePersistedPlayHistory(JSON.stringify(null));
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });
  });

  describe('empty array', () => {
    it('returns null entries and shouldRemove=false for []', () => {
      const result = parsePersistedPlayHistory(JSON.stringify([]));
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(false);
    });
  });

  describe('valid payload', () => {
    it('returns entries for a single valid match', () => {
      const match = makeMatch({ matchNumber: 1, hands: [] });
      const result = parsePersistedPlayHistory(JSON.stringify([match]));
      expect(result.shouldRemove).toBe(false);
      expect(result.entries).toHaveLength(1);
      expect(result.entries![0].matchNumber).toBe(1);
    });

    it('returns entries for multiple valid matches', () => {
      const matches = [makeMatch({ matchNumber: 1 }), makeMatch({ matchNumber: 2 })];
      const result = parsePersistedPlayHistory(JSON.stringify(matches));
      expect(result.entries).toHaveLength(2);
      expect(result.entries![1].matchNumber).toBe(2);
    });

    it('preserves optional fields (winner, startTime, endTime)', () => {
      const match = makeMatch({
        matchNumber: 3,
        winner: 2,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:05:00Z',
      });
      const result = parsePersistedPlayHistory(JSON.stringify([match]));
      expect(result.entries![0].winner).toBe(2);
      expect(result.entries![0].startTime).toBe('2026-01-01T00:00:00Z');
    });

    it('accepts hands with real hand entries', () => {
      const match = makeMatch({
        hands: [{ by: 0, type: 'single', count: 1, cards: [] }],
      });
      const result = parsePersistedPlayHistory(JSON.stringify([match]));
      expect(result.entries![0].hands).toHaveLength(1);
    });
  });

  describe('invalid shape — shouldRemove=true', () => {
    it('returns shouldRemove=true when matchNumber is missing', () => {
      const bad = { hands: [] }; // no matchNumber
      const result = parsePersistedPlayHistory(JSON.stringify([bad]));
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });

    it('returns shouldRemove=true when matchNumber is a string', () => {
      const bad = { matchNumber: '1', hands: [] };
      const result = parsePersistedPlayHistory(JSON.stringify([bad]));
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });

    it('returns shouldRemove=true when hands is missing', () => {
      const bad = { matchNumber: 1 }; // no hands
      const result = parsePersistedPlayHistory(JSON.stringify([bad]));
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });

    it('returns shouldRemove=true when hands is not an array', () => {
      const bad = { matchNumber: 1, hands: 'not-an-array' };
      const result = parsePersistedPlayHistory(JSON.stringify([bad]));
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });

    it('returns shouldRemove=true when any entry in the array is invalid', () => {
      const good = makeMatch({ matchNumber: 1 });
      const bad = { matchNumber: 'two', hands: [] }; // string matchNumber
      const result = parsePersistedPlayHistory(JSON.stringify([good, bad]));
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });

    it('returns shouldRemove=true when an entry is null', () => {
      const result = parsePersistedPlayHistory(JSON.stringify([null]));
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });

    it('returns shouldRemove=true when an entry is a primitive', () => {
      const result = parsePersistedPlayHistory(JSON.stringify([42]));
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });

    it('returns shouldRemove=true when matchNumber is Infinity (1e309)', () => {
      // JSON.parse('{"matchNumber":1e309,"hands":[]}') produces Infinity for matchNumber.
      // typeof Infinity === 'number' is true, so without isFinite the payload would pass.
      const raw = '[{"matchNumber":1e309,"hands":[]}]';
      const result = parsePersistedPlayHistory(raw);
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });

    it('returns shouldRemove=true when matchNumber is null (NaN-equivalent)', () => {
      // matchNumber: null has typeof 'object', not 'number' — should be rejected
      const raw = '[{"matchNumber":null,"hands":[]}]';
      const result = parsePersistedPlayHistory(raw);
      expect(result.entries).toBeNull();
      expect(result.shouldRemove).toBe(true);
    });
  });
});
