import type { PlayHistoryMatch } from '../types/scoreboard';

export interface ParsePlayHistoryResult {
  /** Validated, non-empty PlayHistoryMatch entries (null when nothing usable). */
  entries: PlayHistoryMatch[] | null;
  /** True when the persisted value should be removed (invalid JSON, non-array, bad shape). */
  shouldRemove: boolean;
}

/**
 * Parses and validates a persisted play-history JSON string.
 *
 * Returns `{ entries, shouldRemove }`:
 * - `entries` is a non-empty PlayHistoryMatch[] on success, or `null` otherwise.
 * - `shouldRemove` is `true` when the stored value is corrupted/invalid and
 *   should be deleted from AsyncStorage (invalid JSON, non-array, or array
 *   with entries missing `matchNumber:number` + `hands:array`).
 *   Empty arrays and absent values are NOT flagged for removal.
 *
 * Mirrors the behaviour of `parsePersistedScoreHistory`.
 *
 * @param value Raw string from AsyncStorage (may be null/undefined).
 */
export function parsePersistedPlayHistory(
  value: string | null | undefined
): ParsePlayHistoryResult {
  if (value == null) return { entries: null, shouldRemove: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { entries: null, shouldRemove: true }; // invalid JSON
  }

  if (!Array.isArray(parsed)) return { entries: null, shouldRemove: true }; // non-array
  if (parsed.length === 0) return { entries: null, shouldRemove: false }; // valid empty

  const valid = (parsed as unknown[]).every(
    (entry): entry is PlayHistoryMatch =>
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>).matchNumber === 'number' &&
      Number.isFinite((entry as Record<string, unknown>).matchNumber as number) &&
      Array.isArray((entry as Record<string, unknown>).hands)
  );

  if (!valid) return { entries: null, shouldRemove: true }; // bad shape

  return { entries: parsed as PlayHistoryMatch[], shouldRemove: false };
}
