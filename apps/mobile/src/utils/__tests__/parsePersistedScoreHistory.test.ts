import { parsePersistedScoreHistory } from '../parsePersistedScoreHistory';

describe('parsePersistedScoreHistory', () => {
  const validEntry = {
    matchNumber: 1,
    pointsAdded: [10, -5, 0, -5],
    scores: [10, -5, 0, -5],
  };

  it('returns null entries and shouldRemove=false for null input', () => {
    const result = parsePersistedScoreHistory(null);
    expect(result).toEqual({ entries: null, shouldRemove: false });
  });

  it('returns null entries and shouldRemove=false for undefined input', () => {
    const result = parsePersistedScoreHistory(undefined);
    expect(result).toEqual({ entries: null, shouldRemove: false });
  });

  it('returns shouldRemove=true for invalid JSON', () => {
    const result = parsePersistedScoreHistory('{not-valid-json');
    expect(result).toEqual({ entries: null, shouldRemove: true });
  });

  it('returns shouldRemove=true for non-array JSON (object)', () => {
    const result = parsePersistedScoreHistory(JSON.stringify({ foo: 'bar' }));
    expect(result).toEqual({ entries: null, shouldRemove: true });
  });

  it('returns shouldRemove=true for non-array JSON (string)', () => {
    const result = parsePersistedScoreHistory(JSON.stringify('hello'));
    expect(result).toEqual({ entries: null, shouldRemove: true });
  });

  it('returns shouldRemove=true for non-array JSON (number)', () => {
    const result = parsePersistedScoreHistory(JSON.stringify(42));
    expect(result).toEqual({ entries: null, shouldRemove: true });
  });

  it('returns null entries and shouldRemove=false for empty array', () => {
    const result = parsePersistedScoreHistory(JSON.stringify([]));
    expect(result).toEqual({ entries: null, shouldRemove: false });
  });

  it('returns shouldRemove=true for array with invalid entry shapes', () => {
    const result = parsePersistedScoreHistory(
      JSON.stringify([{ matchNumber: 'not-a-number', pointsAdded: [], scores: [] }])
    );
    expect(result).toEqual({ entries: null, shouldRemove: true });
  });

  it('returns shouldRemove=true for array missing required fields', () => {
    const result = parsePersistedScoreHistory(
      JSON.stringify([{ matchNumber: 1 }]) // missing pointsAdded and scores
    );
    expect(result).toEqual({ entries: null, shouldRemove: true });
  });

  it('returns shouldRemove=true for array with null entries', () => {
    const result = parsePersistedScoreHistory(JSON.stringify([null, validEntry]));
    expect(result).toEqual({ entries: null, shouldRemove: true });
  });

  it('returns valid entries for a single valid entry', () => {
    const result = parsePersistedScoreHistory(JSON.stringify([validEntry]));
    expect(result).toEqual({ entries: [validEntry], shouldRemove: false });
  });

  it('returns valid entries for multiple valid entries', () => {
    const entries = [
      validEntry,
      { matchNumber: 2, pointsAdded: [5, 5, -5, -5], scores: [15, 0, -5, -10] },
    ];
    const result = parsePersistedScoreHistory(JSON.stringify(entries));
    expect(result).toEqual({ entries, shouldRemove: false });
  });

  it('accepts entries with optional timestamp field', () => {
    const entry = { ...validEntry, timestamp: '2026-01-01T00:00:00Z' };
    const result = parsePersistedScoreHistory(JSON.stringify([entry]));
    expect(result.entries).toHaveLength(1);
    expect(result.shouldRemove).toBe(false);
  });
});
