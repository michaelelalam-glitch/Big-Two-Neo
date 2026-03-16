/**
 * Guarded clipboard access.
 *
 * expo-clipboard's native module (ExpoClipboard) may not be present in all
 * environments — Expo Go on beta iOS, web, or an unlinked build. Loading it
 * inside a top-level try/catch means the *module that imports this helper*
 * can still evaluate safely even when the native module is absent, and every
 * call site simply null-checks before using it.
 *
 * Usage:
 *   import { Clipboard } from '../utils/clipboard';
 *   if (Clipboard) await Clipboard.setStringAsync(text);
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
let _clipboard: typeof import('expo-clipboard') | null = null;
try {
  _clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
} catch {
  /* ExpoClipboard native module unavailable (Expo Go / web / unlinked build) */
}

export const Clipboard = _clipboard;
