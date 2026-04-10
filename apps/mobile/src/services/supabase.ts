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
 * C4 Fix: Secure storage adapter for Supabase Auth tokens.
 *
 * Uses expo-secure-store (Keychain on iOS, EncryptedSharedPreferences on Android)
 * for values that fit within the 2048-byte limit. Falls back to AsyncStorage for
 * larger values (e.g. OAuth sessions with long JWT payloads) since SecureStore
 * rejects writes > 2048 bytes on iOS.
 *
 * On web (if ever used), falls back to AsyncStorage entirely since SecureStore
 * is not available.
 */
/** P10-1 Fix: Chunk count key suffix for oversized SecureStore values. */
const CHUNK_COUNT_SUFFIX = '__chunks';
const CHUNK_KEY_SUFFIX = '__chunk_';
/** SecureStore hard limit on iOS/Android. */
const SECURE_STORE_CHUNK_SIZE = 2000; // conservative margin below 2048

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
        // Validate count before using it — corrupt/empty/NaN would cause wrong behaviour
        if (Number.isFinite(count) && count > 0) {
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
      // Fall back to AsyncStorage (for values migrated from previous storage)
      return AsyncStorage.getItem(key);
    } catch {
      // SecureStore can fail on some devices; fall back gracefully
      return AsyncStorage.getItem(key);
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
        if (Number.isFinite(prevCount) && prevCount > 0) {
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
        // Read previous chunk count so we can delete any surplus chunk keys
        // (handles the case where new value has fewer chunks than the old one).
        const prevCountStr = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`).catch(
          () => null
        );
        const prevCount = prevCountStr !== null ? parseInt(prevCountStr, 10) : NaN;
        await SecureStore.setItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`, String(chunks.length));
        for (let i = 0; i < chunks.length; i++) {
          await SecureStore.setItemAsync(`${key}${CHUNK_KEY_SUFFIX}${i}`, chunks[i]);
        }
        // Delete any surplus chunk keys from a previous (longer) value
        if (Number.isFinite(prevCount) && prevCount > chunks.length) {
          await Promise.allSettled(
            Array.from({ length: prevCount - chunks.length }, (_, i) =>
              SecureStore.deleteItemAsync(`${key}${CHUNK_KEY_SUFFIX}${chunks.length + i}`).catch(
                () => {}
              )
            )
          );
        }
        // Clean up any stale non-chunked copies
        await SecureStore.deleteItemAsync(key).catch(() => {});
        await AsyncStorage.removeItem(key).catch(() => {});
      }
    } catch {
      // SecureStore write failed entirely — fall back to AsyncStorage as last resort.
      await AsyncStorage.setItem(key, value);
      await SecureStore.deleteItemAsync(key).catch(() => {});
      await SecureStore.deleteItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`).catch(() => {});
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
      for (let i = 0; i < count; i++) {
        deleteOps.push(
          SecureStore.deleteItemAsync(`${key}${CHUNK_KEY_SUFFIX}${i}`).catch(() => {})
        );
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
