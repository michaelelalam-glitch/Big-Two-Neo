import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API } from '../constants';
import type { Database } from '../types/database.types';

// C3 Fix: Send app version with every Supabase request so edge functions can
// enforce a minimum version and reject outdated clients.
export const APP_VERSION =
  process.env.EXPO_PUBLIC_APP_VERSION ??
  Constants.expoConfig?.version ??
  Constants.manifest2?.extra?.expoClient?.version ??
  '0.0.0';

/** Matches Supabase auth's SupportedStorage interface (not exported from @supabase/supabase-js) */
interface SupabaseAuthStorage {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
}

const supabaseUrl = API.SUPABASE_URL;
const supabaseAnonKey = API.SUPABASE_ANON_KEY;

/**
 * C4/P10-1 Fix: Secure storage adapter for Supabase Auth tokens.
 *
 * Uses expo-secure-store (Keychain on iOS, EncryptedSharedPreferences on Android)
 * for ALL values. Values that exceed the 2048-byte SecureStore limit are split
 * into chunks and stored under sequentially-numbered keys.
 *
 * AsyncStorage is used only on web (no SecureStore) and as a migration read path
 * for pre-P10-1 builds. No new plaintext writes to AsyncStorage are ever made.
 */
/** P10-1 Fix: Chunk count key suffix for oversized SecureStore values. */
const CHUNK_COUNT_SUFFIX = '__chunks';
const CHUNK_KEY_SUFFIX = '__chunk_';
/** SecureStore hard limit on iOS/Android. */
const SECURE_STORE_CHUNK_SIZE = 2000; // conservative margin below 2048
/** Upper bound on chunk count — guards against corrupted metadata creating unbounded work. */
const MAX_CHUNKS = 50; // 50 × 2000 bytes = 100 KB, well above any real auth token size

const SecureStoreAdapter: SupabaseAuthStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return AsyncStorage.getItem(key);
    }
    try {
      // P10-1 Fix: Check for chunked storage first.
      const chunkCountStr = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
      if (chunkCountStr !== null) {
        const count = parseInt(chunkCountStr, 10);
        // Validate count before using it — corrupt/empty/NaN/huge would cause wrong behaviour
        if (Number.isFinite(count) && count > 0 && count <= MAX_CHUNKS) {
          const parts = await Promise.all(
            Array.from({ length: count }, (_, i) =>
              SecureStore.getItemAsync(`${key}${CHUNK_KEY_SUFFIX}${i}`)
            )
          );
          if (parts.every(p => p !== null)) {
            return parts.join('');
          }
        }
        // Corrupt/incomplete chunks — ignore chunk metadata and fall through
      }
      // Try single SecureStore key
      const value = await SecureStore.getItemAsync(key);
      if (value !== null) return value;
      // Migration fallback: read auth sessions stored by pre-P10-1 builds.
      // Immediately queue a re-write to SecureStore so the plaintext copy is
      // erased and future reads no longer fall back to AsyncStorage.
      const legacyValue = await AsyncStorage.getItem(key);
      if (legacyValue !== null) {
        Promise.resolve(SecureStoreAdapter.setItem(key, legacyValue)).catch(() => {
          // Migration write failed; AsyncStorage copy remains until next launch.
        });
      }
      return legacyValue;
    } catch {
      // SecureStore is unavailable on this device. Clear any legacy plaintext
      // copy from pre-P10-1 builds and return null to force re-auth rather than
      // reading an unencrypted token.
      await AsyncStorage.removeItem(key).catch(() => {});
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(key, value);
      return;
    }
    try {
      if (value.length <= SECURE_STORE_CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        // Remove any stale copies from previous storage strategies.
        // Also delete any pre-existing chunk keys (downgrade from chunked → single).
        await AsyncStorage.removeItem(key).catch(() => {});
        const prevCountStr = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`).catch(
          () => null
        );
        const prevCount = prevCountStr !== null ? parseInt(prevCountStr, 10) : NaN;
        await SecureStore.deleteItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`).catch(() => {});
        if (Number.isFinite(prevCount) && prevCount > 0 && prevCount <= MAX_CHUNKS) {
          await Promise.allSettled(
            Array.from({ length: prevCount }, (_, i) =>
              SecureStore.deleteItemAsync(`${key}${CHUNK_KEY_SUFFIX}${i}`).catch(() => {})
            )
          );
        }
      } else {
        // P10-1 Fix: Chunk large values across multiple SecureStore keys
        // so ALL auth tokens stay encrypted, with no plaintext AsyncStorage fallback.
        const chunks: string[] = [];
        for (let i = 0; i < value.length; i += SECURE_STORE_CHUNK_SIZE) {
          chunks.push(value.slice(i, i + SECURE_STORE_CHUNK_SIZE));
        }
        // Guard: abort if the value would require more chunks than MAX_CHUNKS to prevent
        // unbounded SecureStore writes and storage exhaustion from corrupted/oversized tokens.
        if (chunks.length > MAX_CHUNKS) {
          console.error(
            `[supabase:storage] Value too large to chunk (${chunks.length} chunks > MAX_CHUNKS ${MAX_CHUNKS}); auth token NOT persisted.`
          );
          return;
        }
        // Read previous chunk count so we can delete any surplus chunk keys
        // (handles the case where new value has fewer chunks than the old one).
        const prevCountStr = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`).catch(
          () => null
        );
        const prevCount = prevCountStr !== null ? parseInt(prevCountStr, 10) : NaN;
        // Delete old count key, old single-key, AND old AsyncStorage copy FIRST so
        // concurrent getItem cannot observe stale data during the multi-await write window.
        // - No count key        → getItem falls through to single-key check.
        // - No single key       → getItem falls through to AsyncStorage migration path.
        // - No AsyncStorage key → getItem returns null (no stale data / no spurious rewrite).
        // This ensures reads during the write window return null rather than stale data.
        await SecureStore.deleteItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`).catch(() => {});
        await SecureStore.deleteItemAsync(key).catch(() => {});
        await AsyncStorage.removeItem(key).catch(() => {});
        // Write chunk data, then commit the new count key last.
        for (let i = 0; i < chunks.length; i++) {
          await SecureStore.setItemAsync(`${key}${CHUNK_KEY_SUFFIX}${i}`, chunks[i]);
        }
        await SecureStore.setItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`, String(chunks.length));
        // Delete any surplus chunk keys from a previous (longer) value
        if (Number.isFinite(prevCount) && prevCount > chunks.length && prevCount <= MAX_CHUNKS) {
          await Promise.allSettled(
            Array.from({ length: prevCount - chunks.length }, (_, i) =>
              SecureStore.deleteItemAsync(`${key}${CHUNK_KEY_SUFFIX}${chunks.length + i}`).catch(
                () => {}
              )
            )
          );
        }
      }
    } catch {
      // SecureStore write failed entirely — clean up any partial SecureStore state.
      const prevCountOnError = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`)
        .then(s => (s !== null ? parseInt(s, 10) : NaN))
        .catch(() => NaN);
      await SecureStore.deleteItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`).catch(() => {});
      if (
        Number.isFinite(prevCountOnError) &&
        prevCountOnError > 0 &&
        prevCountOnError <= MAX_CHUNKS
      ) {
        await Promise.allSettled(
          Array.from({ length: prevCountOnError }, (_, i) =>
            SecureStore.deleteItemAsync(`${key}${CHUNK_KEY_SUFFIX}${i}`).catch(() => {})
          )
        );
      }
      await SecureStore.deleteItemAsync(key).catch(() => {});
      // Remove any legacy plaintext copy that may exist from pre-P10-1 builds
      // so it cannot be read after this failed write.
      await AsyncStorage.removeItem(key).catch(() => {});
      // Do NOT fall back to AsyncStorage — storing an auth token in plaintext
      // violates the P10-1 security requirement. The caller detects session
      // loss on next launch and prompts the user to re-authenticate.
      console.error('[supabase:storage] SecureStore write failed; auth token NOT persisted.');
    }
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      await AsyncStorage.removeItem(key);
      return;
    }
    // P10-1 Fix: Remove from all storage locations including any chunked keys.
    const chunkCountStr = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`).catch(
      () => null
    );
    const deleteOps: Promise<void>[] = [
      SecureStore.deleteItemAsync(key).catch(() => {}),
      SecureStore.deleteItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`).catch(() => {}),
      AsyncStorage.removeItem(key),
    ];
    if (chunkCountStr !== null) {
      const count = parseInt(chunkCountStr, 10);
      // Validate count before iterating — corrupt/NaN/negative/huge would leave chunk keys behind
      if (Number.isFinite(count) && count > 0 && count <= MAX_CHUNKS) {
        for (let i = 0; i < count; i++) {
          deleteOps.push(
            SecureStore.deleteItemAsync(`${key}${CHUNK_KEY_SUFFIX}${i}`).catch(() => {})
          );
        }
      }
    }
    await Promise.allSettled(deleteOps);
  },
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter as SupabaseAuthStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  db: {
    schema: 'public',
  },
  global: {
    headers: {
      'x-client-info': 'big2-mobile',
      'x-app-version': APP_VERSION,
    },
  },
});
