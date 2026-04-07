import type { ScoreHistory } from '../types/scoreboard';

export interface ParseResult {
  /** Validated, non-empty ScoreHistory entries (null when nothing usable). */
  entries: ScoreHistory[] | null;
  /** True when the persisted value should be removed (invalid JSON, non-array, or bad shape). */
  shouldRemove: boolean;
}

/**
 * Parses and validates a persisted score-history JSON string.
 *
 * Returns `{ entries, shouldRemove }`:
 * - `entries` is a non-empty ScoreHistory[] on success, or `null` otherwise.
 * - `shouldRemove` is `true` when the stored value is corrupted / invalid and
 *   should be deleted from AsyncStorage (invalid JSON, non-array, or array
 *   with incorrect entry shapes). Empty arrays and absent values are NOT
 *   flagged for removal – they're simply nothing to restore.
 *
 * @param value Raw string from AsyncStorage (may be null/undefined).
 */
export function parsePersistedScoreHistory(value: string | null | undefined): ParseResult {
  if (value == null) return { entries: null, shouldRemove: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { entries: null, shouldRemove: true }; // invalid JSON
  }

  if (!Array.isArray(parsed)) return { entries: null, shouldRemove: true }; // non-array
  if (parsed.length === 0) return { entries: null, shouldRemove: false }; // valid empty

  const valid = parsed.every(
    (entry: unknown) =>
      entry != null &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>).matchNumber === 'number' &&
      Array.isArray((entry as Record<string, unknown>).pointsAdded) &&
      Array.isArray((entry as Record<string, unknown>).scores)
  );

  if (!valid) return { entries: null, shouldRemove: true }; // bad shape

  return { entries: parsed as ScoreHistory[], shouldRemove: false };
}
