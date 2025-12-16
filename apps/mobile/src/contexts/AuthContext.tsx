import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { RoomPlayerWithRoom } from '../types';
import { authLogger, roomLogger, notificationLogger } from '../utils/logger';
import { 
  registerForPushNotificationsAsync, 
  savePushTokenToDatabase,
  removePushTokenFromDatabase 
} from '../services/notificationService';
import { soundManager, hapticManager } from '../utils';

/**
 * Profile fetch retry configuration
 * 
 * NETWORK-RESILIENT: Optimized for poor connectivity with fast retries.
 * Balances speed (shorter timeouts) with persistence (more attempts).
 * 
 * Rationale:
 * - MAX_RETRIES: 5 attempts (total 6 tries) - covers spotty networks
 * - RETRY_DELAY_MS: 800ms - fast retry cadence
 * - QUERY_TIMEOUT_MS: 3000ms - 3 seconds per attempt (fail fast, retry more)
 * - FALLBACK: Manual profile creation if DB trigger failed
 * 
 * Strategy: More attempts with shorter timeouts = better for poor networks
 * Total max wait time: ~23 seconds worst case (6 attempts × 3s + 5 delays × 0.8s)
 * Most users will succeed in 1-2 attempts (~3-6s)
 */
const MAX_RETRIES = 5; // 5 retries = 6 total attempts
const RETRY_DELAY_MS = 800; // 0.8 seconds between retries
const QUERY_TIMEOUT_MS = 3000; // 3 seconds per query attempt

export interface Profile {
  id: string;
  username?: string;
  /**
   * @deprecated This field will be removed in version 2.0.0.
   * Use `username` instead. The `full_name` field is maintained for backward compatibility
   * with existing profiles but is no longer actively populated in new registrations.
   */
  full_name?: string;
  avatar_url?: string;
  updated_at?: string;
}

export type AuthContextData = {
  session: Session | null | undefined;
  user: User | null | undefined;
  profile: Profile | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextData>({
  session: undefined,
  user: undefined,
  profile: null,
  isLoading: true,
  isLoggedIn: false,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  // 🔒 CRITICAL FIX: Prevent duplicate parallel fetchProfile calls
  // Without this, TOKEN_REFRESHED + other events trigger simultaneous fetches → timeouts
  const isFetchingProfile = React.useRef<boolean>(false);
  const fetchProfilePromise = React.useRef<Promise<Profile | null> | null>(null);

  /**
   * Register device for push notifications and save token to database
   * This function is idempotent and safe to call multiple times.
   * Returns a Promise<boolean> indicating success (true) or failure (false).
   * Does not throw; errors are logged and false is returned on failure.
   */
  const registerPushNotifications = async (userId: string): Promise<boolean> => {
    try {
      notificationLogger.info('🔔 [registerPushNotifications] Starting registration process...');
      
      // Request permissions and get push token
      const pushToken = await registerForPushNotificationsAsync();
      
      if (!pushToken) {
        notificationLogger.warn('⚠️ [registerPushNotifications] Failed to get push token (might be simulator or permissions denied)');
        return false;
      }
      
      notificationLogger.info('🎯 [registerPushNotifications] Got push token, now saving to database...');
      
      // Save token to database
      const success = await savePushTokenToDatabase(userId, pushToken);
      
      if (success) {
        notificationLogger.info('✅ [registerPushNotifications] Complete! Token saved to database.');
        return true;
      } else {
        notificationLogger.error('❌ [registerPushNotifications] Failed to save token to database');
        return false;
      }
    } catch (error: any) {
      // Don't throw - notification registration should not block authentication
      notificationLogger.error('❌ [registerPushNotifications] Error during registration:', error?.message || String(error));
      return false;
    }
  };

  // Fetch user profile from database with retry logic for race conditions
  const fetchProfile = async (userId: string, retryCount = 0): Promise<Profile | null> => {
    // 🔒 DEDUPLICATION: If already fetching, return existing promise instead of starting new fetch
    // This prevents TOKEN_REFRESHED + other events from triggering parallel duplicate fetches
    if (isFetchingProfile.current && fetchProfilePromise.current) {
      authLogger.info('🔄 [fetchProfile] Already fetching profile, returning existing promise...');
      return fetchProfilePromise.current;
    }
    
    // Mark as fetching and store promise for deduplication
    isFetchingProfile.current = true;
    
    const fetchOperation = (async () => {
      try {
        const attemptNum = retryCount + 1;
        const totalAttempts = MAX_RETRIES + 1;
        authLogger.info(`👤 [fetchProfile] Attempt ${attemptNum}/${totalAttempts} for user: ${userId.substring(0, 8)}...`);
        
        const startTime = Date.now();
        
        // Use simpler query without .single() to avoid PGRST116 errors
        const queryPromise = supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .limit(1);
        
        // Race query against timeout to prevent hanging
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('QUERY_TIMEOUT')), QUERY_TIMEOUT_MS)
        );
        
        const { data, error } = await Promise.race([
          queryPromise,
          timeoutPromise
        ]) as any;
        
        const endTime = Date.now();
        authLogger.info(`⏱️ [fetchProfile] Query completed in ${endTime - startTime}ms`);

        authLogger.info('👤 [fetchProfile] Query completed:', { hasData: !!data, hasError: !!error, errorCode: error?.code, errorMsg: error?.message });

        if (error) {
          authLogger.error('❌ [fetchProfile] Error:', error?.message || error?.code || 'Unknown error');
          
        // Retry on any error
        if (retryCount < MAX_RETRIES) {
          authLogger.warn(`⏳ [fetchProfile] Retrying after error (attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);
          // Keep lock during retry delay to prevent race condition
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          // Clear lock after delay, just before retry
          isFetchingProfile.current = false;
          fetchProfilePromise.current = null;
          return fetchProfile(userId, retryCount + 1);
        }          return null;
        }

        // Handle array response from .limit(1) instead of .single()
        const profileData = Array.isArray(data) ? data[0] : data;
        
        if (!profileData) {
          // Profile not found - could be a race condition with trigger
          if (retryCount < MAX_RETRIES) {
            authLogger.warn(`⏳ [fetchProfile] Profile NOT FOUND yet (attempt ${attemptNum}/${totalAttempts}). Waiting ${RETRY_DELAY_MS}ms for DB trigger...`);
            // Keep lock during retry delay to prevent race condition
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            // Clear lock after delay, just before retry
            isFetchingProfile.current = false;
            fetchProfilePromise.current = null;
            return fetchProfile(userId, retryCount + 1);
          }
          
          // All retries exhausted - create profile manually as fallback
          authLogger.error(`❌ [fetchProfile] Profile NOT FOUND after ${totalAttempts} attempts! Creating manually...`);
          
          try {
            const { data: newProfile, error: insertError } = await supabase
              .from('profiles')
              .insert({
                id: userId,
                username: `Player_${typeof userId === 'string' && userId.length >= 8 ? userId.slice(0, 8) : Date.now().toString(36)}`,
                updated_at: new Date().toISOString(),
              })
              .select()
              .single();
            
            if (insertError) {
              authLogger.error('❌ [fetchProfile] Manual profile creation failed:', insertError.message);
              return null;
            }
            
            authLogger.info('✅ [fetchProfile] Profile created manually:', newProfile?.username);
            return newProfile;
          } catch (createError: any) {
            authLogger.error('❌ [fetchProfile] Exception during manual creation:', createError?.message);
            return null;
          }
        }

        authLogger.info('✅ [fetchProfile] Profile found:', { username: profileData?.username, id: userId });
        return profileData;
      } catch (error: any) {
        const attemptNum = retryCount + 1;
        const totalAttempts = MAX_RETRIES + 1;
        
        // Check if it's a timeout
        if (error?.message === 'QUERY_TIMEOUT') {
          authLogger.error(`⏱️ [fetchProfile] Query TIMED OUT after ${QUERY_TIMEOUT_MS}ms! (attempt ${attemptNum}/${totalAttempts})`);
          
          if (retryCount < MAX_RETRIES) {
            authLogger.warn(`♻️ [fetchProfile] Retrying after timeout... (${RETRY_DELAY_MS}ms delay)`);
            // Keep lock during retry delay to prevent race condition
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            // Clear lock after delay, just before retry
            isFetchingProfile.current = false;
            fetchProfilePromise.current = null;
            return fetchProfile(userId, retryCount + 1);
          } else {
            authLogger.error('❌ [fetchProfile] GIVING UP after all timeout retries. Poor network or Supabase not responding.');
            authLogger.error('💡 [fetchProfile] TIP: User can pull-to-refresh on Profile screen to retry.');
            // Return null to allow app to continue loading without profile
            return null;
          }
        }
        
        // Other errors
        authLogger.error(`❌ [fetchProfile] Unexpected error (attempt ${attemptNum}/${totalAttempts}):`, error?.message || error?.code || String(error));
        
        // Retry on any error if attempts remain
        if (retryCount < MAX_RETRIES) {
          authLogger.warn(`♻️ [fetchProfile] Retrying after error... (${RETRY_DELAY_MS}ms delay)`);
          // Keep lock during retry delay to prevent race condition
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          // Clear lock after delay, just before retry
          isFetchingProfile.current = false;
          fetchProfilePromise.current = null;
          return fetchProfile(userId, retryCount + 1);
        }
        
        return null;
      }
    })();
    
    // Store promise for deduplication
    fetchProfilePromise.current = fetchOperation;
    
    try {
      const result = await fetchOperation;
      return result;
    } finally {
      // 🔓 Clear lock after fetch completes (success or failure)
      isFetchingProfile.current = false;
      fetchProfilePromise.current = null;
    }
  };

  // Refresh profile data
  const refreshProfile = async () => {
    if (session?.user) {
      const profileData = await fetchProfile(session.user.id);
      setProfile(profileData);
    }
  };

  // Clean up stale room memberships (e.g., from force-closed app)
  const cleanupStaleRoomMembership = async (userId: string) => {
    try {
      roomLogger.info('🧹 [AuthContext] Cleaning up stale room memberships for user:', userId);
      
      // Check if user is in any room
      const { data: roomMemberships, error: checkError } = await supabase
        .from('room_players')
        .select('room_id, rooms!inner(code, status)')
        .eq('user_id', userId);

      if (checkError) {
        roomLogger.error('❌ [AuthContext] Error checking room memberships:', checkError?.message || checkError?.code || 'Unknown error');
        return;
      }

      const memberships: RoomPlayerWithRoom[] = (roomMemberships || [])
        .map((rm: any) => {
          const normalizedRoom = rm.rooms == null
            ? null
            : Array.isArray(rm.rooms)
              ? (rm.rooms.length > 0 ? rm.rooms[0] : null)
              : rm.rooms;
          
          return {
            ...rm,
            rooms: normalizedRoom
          };
        })
        .filter((rm): rm is RoomPlayerWithRoom => rm.rooms !== null && rm.rooms !== undefined);
      if (memberships.length === 0) {
        roomLogger.info('✅ [AuthContext] No stale rooms found');
        return;
      }

      roomLogger.info(`⚠️ [AuthContext] Found ${memberships.length} stale room(s):`, 
        memberships.map(rm => rm.rooms?.code || 'unknown').join(', '));

      // ENHANCED CLEANUP: Remove user from ALL non-active rooms on sign-in
      // This fixes the multi-account Google auth issue where stale usernames block new sign-ins
      // Strategy:
      // 1. Remove from 'waiting' rooms (lobbies that never started)
      // 2. Remove from 'finished' rooms (completed games)
      // 3. Keep 'playing' rooms only if game is active (for reconnection)
      const roomsToClean = memberships.filter(rm => {
        const status = rm.rooms?.status;
        // Clean up waiting and finished rooms
        return status === 'waiting' || status === 'finished';
      });

      const roomIdsToClean = roomsToClean.map(rm => rm.room_id);

      if (roomIdsToClean.length === 0) {
        roomLogger.info('✅ [AuthContext] No stale rooms to clean up');
      } else {
        const { error: deleteError } = await supabase
          .from('room_players')
          .delete()
          .eq('user_id', userId)
          .in('room_id', roomIdsToClean);

        if (deleteError) {
          roomLogger.error('❌ [AuthContext] Error removing stale memberships:', deleteError?.message || deleteError?.code || 'Unknown error');
        } else {
          roomLogger.info(`✅ [AuthContext] Successfully cleaned up ${roomIdsToClean.length} stale room memberships (waiting/finished)`);
        }
      }
    } catch (error: any) {
      roomLogger.error('❌ [AuthContext] Unexpected error in cleanup:', error?.message || error?.code || String(error));
    }
  };

  // Initialize auth state
  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        setIsLoading(true);

        // 🎵 CRITICAL: Initialize audio/haptic managers on app startup
        authLogger.info('🎵 [AuthContext] Initializing audio & haptic managers...');
        try {
          await Promise.all([
            soundManager.initialize(),
            hapticManager.initialize()
          ]);
          authLogger.info('✅ [AuthContext] Audio & haptic managers initialized');
        } catch (audioError: any) {
          // Non-blocking error - app continues without audio/haptics
          authLogger.error('⚠️ [AuthContext] Failed to initialize audio/haptic managers:', audioError?.message || String(audioError));
          authLogger.warn('⚠️ [AuthContext] App will continue without sound effects and vibration');
          // User will notice missing audio/haptics naturally during gameplay
          // No need for intrusive alert on startup
        }

        // Get initial session
        const {
          data: { session: initialSession },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          // Only log error message to avoid exposing auth internals/tokens
          authLogger.error('Error fetching session:', error?.message || error?.code || 'Unknown error');
        }

        if (mounted) {
          setSession(initialSession);
          setUser(initialSession?.user ?? null);

          // Fetch profile if user exists
          if (initialSession?.user) {
            const profileData = await fetchProfile(initialSession.user.id);
            setProfile(profileData);
            
            // CRITICAL FIX: Clean up stale room memberships on login
            // This handles cases where user force-closed app or didn't properly leave
            await cleanupStaleRoomMembership(initialSession.user.id);
            
            // 🔔 PUSH NOTIFICATIONS: Register in background (non-blocking)
            // This ensures users receive game notifications on their device
            authLogger.info('🔔 [AuthContext] Registering for push notifications...');
            registerPushNotifications(initialSession.user.id).catch((err) => {
              authLogger.error('Error registering for push notifications:', err?.message || err?.code || String(err));
            }); // Fire-and-forget with error logging
          }

          setIsLoading(false);
          authLogger.info('✅ [AuthContext] Initialization complete, session:', initialSession ? 'present' : 'null');
        }
      } catch (error: any) {
        // Only log error message to avoid exposing auth internals/tokens
        authLogger.error('Error initializing auth:', error?.message || error?.code || String(error));
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      // Redact sensitive session data (contains access/refresh tokens)
      const sanitizedSession = newSession ? {
        user: { id: newSession.user.id, email: newSession.user.email },
        expires_at: newSession.expires_at
      } : null;
      authLogger.info('🔄 [AuthContext] Auth state changed:', { event: _event, session: sanitizedSession });

      // 🔧 FIX: Ignore INITIAL_SESSION events - handled by initializeAuth
      // The initialization code above already handles the initial session fetch and profile loading
      // This prevents race conditions where both init and onAuthStateChange try to load profile
      if (_event === 'INITIAL_SESSION') {
        authLogger.info('⏭️ [AuthContext] Skipping INITIAL_SESSION event (handled by initialization)');
        return;
      }

      // 🚨 CRITICAL FIX: Handle SIGNED_IN by updating session state ONLY
      // Google OAuth calls setSession() which fires SIGNED_IN, but auth tokens aren't ready yet
      // Solution: Update session state → Navigate to home → Profile fetch happens via useEffect below
      // when Supabase client has valid tokens
      if (_event === 'SIGNED_IN' && mounted && newSession?.user) {
        authLogger.info('🔑 [AuthContext] SIGNED_IN event - updating session state (profile will load via useEffect)');
        setSession(newSession);
        setUser(newSession.user);
        // Don't set isLoading - let the useEffect below handle profile fetch with proper timing
        return; // Exit early - profile fetch will happen in the useEffect watching 'session'
      }

      // 🚨 CRITICAL FIX: Handle TOKEN_REFRESHED silently without blocking UI
      // Token refresh happens automatically every ~50 minutes during active gameplay
      // Blocking the UI with loading screen during refresh disrupts game flow
      // Instead, we silently update the session in the background
      const shouldBlockUI = _event === 'SIGNED_OUT';
      const isSilentRefresh = _event === 'TOKEN_REFRESHED';

      if (isSilentRefresh) {
        authLogger.info('🔄 [AuthContext] Silent token refresh - updating session without blocking UI');
      }

      if (mounted) {
        // Only block UI for actual sign-in/sign-out events, NOT for token refresh
        if (newSession?.user && shouldBlockUI) {
          authLogger.info('⏳ [AuthContext] Session detected, keeping loading state until profile is ready...');
          setIsLoading(true);
        }

        authLogger.info('🔄 [AuthContext] Setting session state...', { hasSession: !!newSession });
        setSession(newSession);
        setUser(newSession?.user ?? null);

        // Fetch profile when session changes
        let profileData = null;
        if (newSession?.user) {
          // 🚨 CRITICAL: For silent token refresh, skip profile fetch if we already have one
          // This prevents unnecessary network calls and UI disruption during gameplay
          if (isSilentRefresh && profile) {
            authLogger.info('⏭️ [AuthContext] Skipping profile fetch on token refresh (already loaded)');
            // Push notifications already registered on sign-in, no need to re-register
            return; // Exit early, no state changes needed
          }
          
          // 🚨 CRITICAL: Also skip profile fetch for silent refresh even if profile is null
          // The profile will be loaded by the useEffect below or initializeAuth
          // This prevents the 6-attempt retry spam on reconnection
          if (isSilentRefresh) {
            authLogger.info('⏭️ [AuthContext] Skipping profile fetch on token refresh (will load via useEffect if needed)');
            return; // Exit early, no state changes needed
          }
          
          try {
            authLogger.info('👤 [AuthContext] Fetching profile for user:', newSession.user.id);
            profileData = await fetchProfile(newSession.user.id);
            if (profileData) {
              authLogger.info('✅ [AuthContext] Profile found:', profileData.username);
            } else {
              authLogger.error('❌ [AuthContext] Profile NOT found! User:', newSession.user.id);
              authLogger.error('❌ [AuthContext] App will continue without profile data. The user may experience limited or degraded functionality until profile information is available.');
            }
            setProfile(profileData);
            
            // 🔔 PUSH NOTIFICATIONS: Register in background (non-blocking)
            // This handles new sign-ins (SIGNED_IN event) and ensures token is registered
            // Skip for token refresh to avoid redundant registration
            if (!isSilentRefresh) {
              authLogger.info('🔔 [AuthContext] Registering for push notifications...');
              registerPushNotifications(newSession.user.id).catch((err) => {
                authLogger.error('Error registering for push notifications:', err?.message || err?.code || String(err));
              }); // Fire-and-forget with error logging
            }
          } catch (fetchError: any) {
            authLogger.error('❌ [AuthContext] CRITICAL: Profile fetch threw exception:', fetchError?.message);
            setProfile(null);
          } finally {
            // CRITICAL: ALWAYS clear loading state, even if profile fetch fails
            // This prevents infinite loading screen
            // For silent refresh, this should be no-op since we never set loading=true
            if (shouldBlockUI) {
              setIsLoading(false);
              authLogger.info('✅ [AuthContext] Profile fetch complete, clearing loading state');
            }
          }
        } else {
          authLogger.info('🚪 [AuthContext] No session - clearing profile');
          setProfile(null);
          setIsLoading(false);
        }
        
        authLogger.info('📊 [AuthContext] Final state:', { 
          hasSession: !!newSession, 
          hasProfile: !!profileData,
          isLoggedIn: !!newSession,
          isLoading: !newSession || !!profileData
        });
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // 🚨 CRITICAL FIX: Fetch profile when session changes (after SIGNED_IN event)
  // This runs AFTER the SIGNED_IN event handler updates session state
  // At this point, Supabase client has valid auth tokens and profile fetch will succeed
  useEffect(() => {
    if (!session?.user || profile) {
      return; // Skip if no session or profile already loaded
    }

    authLogger.info('👤 [AuthContext] Session changed, fetching profile for user:', session.user.id);
    
    const loadProfile = async () => {
      try {
        const profileData = await fetchProfile(session.user.id);
        if (profileData) {
          authLogger.info('✅ [AuthContext] Profile loaded:', profileData.username);
          setProfile(profileData);
          
          // Clean up stale rooms
          await cleanupStaleRoomMembership(session.user.id);
          
          // Register push notifications in background
          authLogger.info('🔔 [AuthContext] Registering for push notifications...');
          registerPushNotifications(session.user.id).catch((err) => {
            authLogger.error('Error registering for push notifications:', err?.message || err?.code || String(err));
          });
        } else {
          authLogger.error('❌ [AuthContext] Profile NOT found! User:', session.user.id);
        }
      } catch (error: any) {
        authLogger.error('❌ [AuthContext] Error loading profile:', error?.message);
      }
    };

    loadProfile();
  }, [session, profile]);

  // Sign out function
  // ENHANCED: Clean up room_players entries on sign-out to prevent username conflicts
  const signOut = async () => {
    try {
      const currentUserId = user?.id;
      
      // CRITICAL: Clean up room_players entries BEFORE signing out
      // This prevents stale username entries that block future sign-ins
      if (currentUserId) {
        authLogger.info('🧹 [AuthContext] Cleaning up user data before sign-out');
        
        // 🔔 PUSH NOTIFICATIONS: Remove push token from database on sign-out
        authLogger.info('🔔 [AuthContext] Removing push token...');
        await removePushTokenFromDatabase(currentUserId);
        
        // Remove ALL room_players entries for this user
        const { error: cleanupError } = await supabase
          .from('room_players')
          .delete()
          .eq('user_id', currentUserId);

        if (cleanupError) {
          authLogger.error('⚠️ [AuthContext] Error cleaning up room data on sign-out:', cleanupError?.message);
          // Continue with sign-out even if cleanup fails
        } else {
          authLogger.info('✅ [AuthContext] Successfully cleaned up all room data');
        }
      }

      const { error } = await supabase.auth.signOut();
      if (error) {
        // Only log error message to avoid exposing auth tokens/session data
        authLogger.error('Error signing out:', error?.message || String(error));
        throw error;
      }
      
      authLogger.info('✅ [AuthContext] Sign-out successful');
    } catch (error: any) {
      // Only log error message to avoid exposing auth tokens/session data
      authLogger.error('Error signing out:', error?.message || String(error));
      throw error;
    }
  };

  const value: AuthContextData = {
    session,
    user,
    profile,
    isLoading,
    isLoggedIn: !!session,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
