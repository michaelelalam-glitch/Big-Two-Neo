/**
 * Tests for isExpectedTurnRaceError utility
 *
 * Critical boundary: the helper must NOT classify the locally-thrown
 * 'Player not found' error (realtimeActions.ts pre-check) as an expected
 * race — only the server response 'Player not found in room' should match.
 */

import { isExpectedTurnRaceError } from '../../utils/edgeFunctionErrors';

describe('isExpectedTurnRaceError', () => {
  describe('expected-race patterns (should return true)', () => {
    it('matches "Not your turn" (canonical client pre-check)', () => {
      expect(isExpectedTurnRaceError('Not your turn')).toBe(true);
    });

    it('matches "not your turn" (lowercase server variant)', () => {
      expect(isExpectedTurnRaceError('not your turn')).toBe(true);
    });

    it('matches "Not player X\'s turn …" (server turn-advance race)', () => {
      expect(isExpectedTurnRaceError("Not player 2's turn (current turn: 1)")).toBe(true);
    });

    it('matches "Player not found in room" (server disconnection race)', () => {
      expect(isExpectedTurnRaceError('Player not found in room')).toBe(true);
    });

    it('matches "player not found in room" (lowercase variant)', () => {
      expect(isExpectedTurnRaceError('player not found in room')).toBe(true);
    });
  });

  describe('non-race patterns (should return false)', () => {
    it('does NOT match bare "Player not found" (local client-state bug)', () => {
      expect(isExpectedTurnRaceError('Player not found')).toBe(false);
    });

    it('does NOT match "player not found" (lowercase local error)', () => {
      expect(isExpectedTurnRaceError('player not found')).toBe(false);
    });

    it('does NOT match unrelated errors', () => {
      expect(isExpectedTurnRaceError('Must play highest card')).toBe(false);
      expect(isExpectedTurnRaceError('Invalid play')).toBe(false);
      expect(isExpectedTurnRaceError('Network request failed')).toBe(false);
      expect(isExpectedTurnRaceError('')).toBe(false);
    });
  });
});
