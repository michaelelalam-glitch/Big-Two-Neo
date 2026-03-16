/**
 * Guarded clipboard access + copy-with-share-fallback helper.
 *
 * expo-clipboard's native module (ExpoClipboard) may not be present in all
 * environments — Expo Go on beta iOS, web, or an unlinked build. Loading it
 * inside a top-level try/catch means the *module that imports this helper*
 * can still evaluate safely even when the native module is absent, and every
 * call site simply null-checks before using it.
 *
 * Usage:
 *   import { Clipboard, tryCopyTextWithShareFallback } from '../utils/clipboard';
 *   if (Clipboard) await Clipboard.setStringAsync(text);
 *
 *   // Or use the helper for copy-with-share-fallback in one call:
 *   const result = await tryCopyTextWithShareFallback(text, shareTitle);
 *   if (result === 'copied') { /* show success alert *\/ }
 *   else if (result === 'failed') { /* show failure alert *\/ }
 *   // 'shared': Share sheet was presented — no additional alert needed
 */

import { Share } from 'react-native';

let _clipboard: typeof import('expo-clipboard') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
} catch {
  /* ExpoClipboard native module unavailable (Expo Go / web / unlinked build) */
}

export const Clipboard = _clipboard;

/**
 * Try to copy `text` to the clipboard.
 * If the clipboard module is unavailable or throws, fall back to the native
 * Share sheet (which includes a built-in Copy option).
 *
 * @returns
 *   - `'copied'`  — text was written to the clipboard successfully
 *   - `'shared'`  — clipboard failed; Share sheet was presented instead
 *   - `'failed'`  — both clipboard and Share threw (e.g. no sharing capabilities)
 */
export type CopyResult = 'copied' | 'shared' | 'failed';

export async function tryCopyTextWithShareFallback(
  text: string,
  shareTitle?: string,
): Promise<CopyResult> {
  if (Clipboard) {
    try {
      await Clipboard.setStringAsync(text);
      return 'copied';
    } catch {
      // clipboard unavailable — fall through to Share
    }
  }
  try {
    // Share.share() resolves (not throws) on cancellation: action === dismissedAction.
    // Both sharedAction and dismissedAction mean no additional error UI is needed;
    // only a real API failure (throw) should propagate as 'failed'.
    const shareResult = await Share.share({ message: text, title: shareTitle });
    if (
      shareResult.action === Share.sharedAction ||
      shareResult.action === Share.dismissedAction
    ) {
      return 'shared';
    }
    return 'failed';
  } catch {
    // Share API threw a genuine error (e.g. no sharing capabilities on this platform).
    // Note: user cancellation resolves normally with dismissedAction above — it never throws.
    return 'failed';
  }
}
