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
const SecureStoreAdapter: SupabaseAuthStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return AsyncStorage.getItem(key);
    }
    try {
      // Try SecureStore first
      const value = await SecureStore.getItemAsync(key);
      if (value !== null) return value;
      // Fall back to AsyncStorage (for migrated or oversized values)
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
      // SecureStore has a 2048-byte limit on iOS
      if (value.length <= 2048) {
        await SecureStore.setItemAsync(key, value);
        // Remove any stale AsyncStorage copy from before migration
        await AsyncStorage.removeItem(key).catch(() => {});
      } else {
        // Value too large for SecureStore — use AsyncStorage.
        // TODO (Sprint 2): Consider chunking across multiple SecureStore keys
        // to avoid any plaintext fallback for oversized sessions/JWTs.
        await AsyncStorage.setItem(key, value);
        // Remove any stale SecureStore copy
        await SecureStore.deleteItemAsync(key).catch(() => {});
      }
    } catch {
      // SecureStore write failed — fall back to AsyncStorage.
      // Clear any stale SecureStore copy so getItem cannot return an older value.
      await AsyncStorage.setItem(key, value);
      await SecureStore.deleteItemAsync(key).catch(() => {});
    }
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      await AsyncStorage.removeItem(key);
      return;
    }
    // Remove from both stores to ensure cleanup
    await Promise.allSettled([SecureStore.deleteItemAsync(key), AsyncStorage.removeItem(key)]);
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
