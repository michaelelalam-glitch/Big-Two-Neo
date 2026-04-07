import type { ScoreHistory } from '../types/scoreboard';

/**
 * Parses and validates a persisted score-history JSON string.
 * Returns a non-empty ScoreHistory array on success, or null if the value
 * is absent, empty, or fails shape validation.
 *
 * @param value Raw string from AsyncStorage (may be null/undefined).
 * @returns Validated ScoreHistory[] or null.
 */
export function parsePersistedScoreHistory(
  value: string | null | undefined
): ScoreHistory[] | null {
  if (!value) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0) return null; // valid but nothing to restore

  const valid = parsed.every(
    (entry: unknown) =>
      entry != null &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>).matchNumber === 'number' &&
      Array.isArray((entry as Record<string, unknown>).pointsAdded) &&
      Array.isArray((entry as Record<string, unknown>).scores)
  );

  return valid ? (parsed as ScoreHistory[]) : null;
}
