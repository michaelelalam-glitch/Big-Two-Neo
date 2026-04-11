/**
 * Attestation Service — P10-4 App Attestation
 *
 * Wraps platform-specific device integrity checks:
 *   • Android: Google Play Integrity API
 *   • iOS:     Apple App Attest
 *
 * The service calls the `verify-attestation` Supabase Edge Function to
 * validate the device token server-side. Results are cached for the session
 * so repeated calls (e.g. before each sensitive action) don't re-trigger the
 * native API unnecessarily.
 *
 * ─── NATIVE MODULE DEPENDENCY ───────────────────────────────────────────────
 * This module depends on native APIs that require a custom bare workflow or a
 * compatible Expo module:
 *
 *   Android: Install `@infominds/react-native-play-integrity` or equivalent
 *            that exposes `PlayIntegrity.requestIntegrityToken(nonce)`.
 *
 *   iOS:     Install `react-native-app-attest` or equivalent that exposes
 *            `AppAttest.generateKey()` and `AppAttest.generateAssertion(keyId, clientData)`.
 *
 * If the native module is not yet installed, both methods gracefully return
 * `{ passed: true, skipped: true }` with a logged warning so the rest of the
 * app continues to work. The `canAttest()` helper lets callers check first.
 *
 * Tasks: P10-4
 */

import { Platform } from 'react-native';
import { networkLogger } from '../utils/logger';
import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────────── //

export interface AttestationResult {
  /** true when attestation passed or was skipped (native module absent / env unconfigured). */
  passed: boolean;
  /** true when no native attestation was performed (module not installed / not supported). */
  skipped?: boolean;
  /** Human-readable reason for logging / analytics. */
  reason?: string;
}

// ─── Session cache ───────────────────────────────────────────────────────── //

let _cachedResult: AttestationResult | null = null;
/** Stored iOS key ID (generated once per install by App Attest). */
let _iosKeyId: string | null = null;

// ─── Native module resolution (lazy, fail-soft) ──────────────────────────── //

/**
 * Attempts to load the Play Integrity module (Android). Returns null if absent.
 *
 * The package `@infominds/react-native-play-integrity` is an optional peer dep
 * that is NOT listed in package.json. To activate Android integrity checks, add it
 * to `optionalDependencies` and re-install. Metro resolves string-literal require()
 * calls at bundle time; if the module is absent from node_modules the try/catch
 * catches the MODULE_NOT_FOUND error at runtime and returns null.
 */
function loadPlayIntegrityModule(): {
  requestIntegrityToken(nonce: string): Promise<string>;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@infominds/react-native-play-integrity') as {
      requestIntegrityToken(nonce: string): Promise<string>;
    };
  } catch {
    return null;
  }
}

/**
 * Attempts to load the App Attest module (iOS). Returns null if absent.
 *
 * The package `react-native-app-attest` is an optional peer dep that is NOT listed
 * in package.json. To activate iOS integrity checks, add it to `optionalDependencies`
 * and re-install. Same Metro resolution note as `loadPlayIntegrityModule` above.
 */
function loadAppAttestModule(): {
  generateKey(): Promise<string>;
  generateAssertion(keyId: string, clientData: string): Promise<string>;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-app-attest') as {
      generateKey(): Promise<string>;
      generateAssertion(keyId: string, clientData: string): Promise<string>;
    };
  } catch {
    return null;
  }
}

// ─── Android (Play Integrity) ─────────────────────────────────────────────── //

async function attestAndroid(): Promise<AttestationResult> {
  const PlayIntegrity = loadPlayIntegrityModule();
  if (!PlayIntegrity) {
    networkLogger.warn(
      '[Attestation] Android: @infominds/react-native-play-integrity not installed — skipping attestation'
    );
    return { passed: true, skipped: true, reason: 'module_missing' };
  }

  // crypto.randomUUID() is available on modern React Native (v0.73+) but not guaranteed
  // on all older runtimes. Fall back to a manual hex generator if it's missing.
  const randomUUID: () => string =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? () => crypto.randomUUID()
      : () => {
          const bytes = new Uint8Array(16);
          // eslint-disable-next-line no-bitwise
          if (typeof crypto !== 'undefined' && crypto.getRandomValues)
            crypto.getRandomValues(bytes);
          // eslint-disable-next-line no-bitwise
          bytes[6] = (bytes[6] & 0x0f) | 0x40;
          // eslint-disable-next-line no-bitwise
          bytes[8] = (bytes[8] & 0x3f) | 0x80;
          return [...bytes]
            .map((b, i) =>
              [4, 6, 8, 10].includes(i)
                ? `-${b.toString(16).padStart(2, '0')}`
                : b.toString(16).padStart(2, '0')
            )
            .join('');
        };
  const nonce = randomUUID().replace(/-/g, '');
  const token = await PlayIntegrity.requestIntegrityToken(nonce);

  const { data, error } = await supabase.functions.invoke('verify-attestation', {
    body: { platform: 'android', token },
  });

  if (error) {
    networkLogger.warn('[Attestation] Android: EF call failed — fail-open', error.message);
    return { passed: true, skipped: true, reason: 'ef_error' };
  }

  const result = data as { success: boolean; passed: boolean; reason?: string };
  return { passed: result.passed, reason: result.reason };
}

// ─── iOS (App Attest) ─────────────────────────────────────────────────────── //

async function attestIOS(): Promise<AttestationResult> {
  const AppAttest = loadAppAttestModule();
  if (!AppAttest) {
    networkLogger.warn(
      '[Attestation] iOS: react-native-app-attest not installed — skipping attestation'
    );
    return { passed: true, skipped: true, reason: 'module_missing' };
  }

  // Generate key once; reuse on subsequent calls
  if (!_iosKeyId) {
    _iosKeyId = await AppAttest.generateKey();
  }

  // randomUUID fallback — crypto.randomUUID() not guaranteed on all RN runtimes.
  const randomUUID: () => string =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? () => crypto.randomUUID()
      : () => {
          const bytes = new Uint8Array(16);
          // eslint-disable-next-line no-bitwise
          if (typeof crypto !== 'undefined' && crypto.getRandomValues)
            crypto.getRandomValues(bytes);
          // eslint-disable-next-line no-bitwise
          bytes[6] = (bytes[6] & 0x0f) | 0x40;
          // eslint-disable-next-line no-bitwise
          bytes[8] = (bytes[8] & 0x3f) | 0x80;
          return [...bytes]
            .map((b, i) =>
              [4, 6, 8, 10].includes(i)
                ? `-${b.toString(16).padStart(2, '0')}`
                : b.toString(16).padStart(2, '0')
            )
            .join('');
        };
  const challenge = randomUUID();

  // App Attest generateAssertion expects a SHA-256 hash of the clientData, not the raw
  // challenge string. Compute it via Web Crypto; bail out (fail-open) if unavailable.
  let clientDataHash: string;
  try {
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(challenge));
    clientDataHash = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));
  } catch {
    networkLogger.warn('[Attestation] iOS: crypto.subtle unavailable — skipping attestation');
    return { passed: true, skipped: true, reason: 'crypto_unavailable' };
  }
  const assertion = await AppAttest.generateAssertion(_iosKeyId, clientDataHash);

  const { data, error } = await supabase.functions.invoke('verify-attestation', {
    body: { platform: 'ios', token: assertion, keyId: _iosKeyId },
  });

  if (error) {
    networkLogger.warn('[Attestation] iOS: EF call failed — fail-open', error.message);
    return { passed: true, skipped: true, reason: 'ef_error' };
  }

  const result = data as { success: boolean; passed: boolean; reason?: string };
  return { passed: result.passed, reason: result.reason };
}

// ─── Public API ───────────────────────────────────────────────────────────── //

/**
 * Returns true when the current platform has a compatible native attestation
 * module installed. Use to conditionally gate UI or show device-trust warnings.
 */
export function canAttest(): boolean {
  if (Platform.OS === 'android') return loadPlayIntegrityModule() !== null;
  if (Platform.OS === 'ios') return loadAppAttestModule() !== null;
  return false;
}

/**
 * Performs device attestation and returns the result. Results are cached for
 * the session so subsequent calls return the same verdict instantly.
 *
 * The function is fail-open: any network or native error returns
 * `{ passed: true, skipped: true }` so gameplay is never blocked.
 */
export async function attestDevice(): Promise<AttestationResult> {
  if (_cachedResult) return _cachedResult;

  try {
    let result: AttestationResult;
    if (Platform.OS === 'android') {
      result = await attestAndroid();
    } else if (Platform.OS === 'ios') {
      result = await attestIOS();
    } else {
      result = { passed: true, skipped: true, reason: 'unsupported_platform' };
    }
    _cachedResult = result;
    if (!result.passed) {
      networkLogger.warn(
        '[Attestation] Device failed attestation — flagged for review. passed=false reason=' +
          (result.reason ?? 'unknown')
      );
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    networkLogger.warn('[Attestation] Unexpected error — fail-open', message);
    return { passed: true, skipped: true, reason: 'unexpected_error' };
  }
}

/**
 * Clears the session cache. Can be called on sign-out or user switch to force
 * re-attestation on the next sensitive action.
 */
export function clearAttestationCache(): void {
  _cachedResult = null;
  _iosKeyId = null;
}
