import { supabase } from './supabase';

export const isE2EBypass = (): boolean => {
  return process.env.EXPO_PUBLIC_E2E_AUTH_BYPASS === 'true';
};

export const performE2EAuthBypass = async (): Promise<boolean> => {
  if (!isE2EBypass()) {
    return false;
  }

  const email = process.env.EXPO_PUBLIC_E2E_EMAIL;
  const password = process.env.EXPO_PUBLIC_E2E_PASSWORD;

  if (!email || !password) {
    console.warn('[E2E] Auth bypass enabled but EXPO_PUBLIC_E2E_EMAIL or EXPO_PUBLIC_E2E_PASSWORD is missing');
    return false;
  }

  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      console.warn('[E2E] Failed to read current session before bypass sign-in:', sessionError.message);
    }

    if (session) {
      console.log('[E2E] Existing authenticated session found, skipping bypass sign-in');
      return true;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      console.error('[E2E] Bypass sign-in failed:', signInError.message);
      return false;
    }

    console.log('[E2E] Bypass sign-in succeeded');
    return true;
  } catch (error) {
    console.error('[E2E] Unexpected bypass auth error:', error);
    return false;
  }
};
