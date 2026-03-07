/**
 * rateLimitUtils — shared rate-limit error detection helpers (Task #281)
 *
 * Extracted from CreateRoomScreen.tsx so the logic can be:
 *   a) imported by production screens/hooks
 *   b) tested directly without rendering a full component tree
 *
 * Usage:
 *   import { isRateLimitError } from '../utils/rateLimitUtils';
 *   if (isRateLimitError(err)) showError(i18n.t('room.createRoomRateLimited'));
 */

/**
 * Returns true when `error` represents a rate-limit rejection from Supabase.
 *
 * Supabase surfaces the Postgres custom SQLSTATE P0429 directly in the error
 * object's `code` field. We also match on the lowercased message text as a
 * belt-and-suspenders fallback (e.g. Realtime / REST error wrapping).
 */
export function isRateLimitError(error: unknown): boolean {
  if (error == null) return false;
  const code = (error as { code?: string })?.code;
  if (code === 'P0429') return true;
  const msg = error instanceof Error ? error.message : String(error);
  return msg.toLowerCase().includes('rate limit');
}
