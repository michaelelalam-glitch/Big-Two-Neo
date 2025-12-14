import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API } from '../constants';
import { networkLogger } from '../utils/logger';

const supabaseUrl = API.SUPABASE_URL;
const supabaseAnonKey = API.SUPABASE_ANON_KEY;

// AsyncStorage adapter for Supabase Auth
// Using AsyncStorage instead of SecureStore to handle large OAuth sessions
// that exceed the 2048-byte SecureStore limit (as recommended by Supabase docs)
const AsyncStorageAdapter = {
  getItem: (key: string) => {
    return AsyncStorage.getItem(key);
  },
  setItem: (key: string, value: string) => {
    return AsyncStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    return AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorageAdapter as any,
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
    },
  },
});
