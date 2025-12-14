import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { RoomPlayerWithRoom } from '../types';
import { authLogger, roomLogger } from '../utils/logger';

/**
 * Profile fetch retry configuration
 * 
 * These values have been tuned through testing to balance user experience with reliability:
 * - MAX_RETRIES: 4 attempts handles transient network/DB issues without excessive delay
 * - RETRY_DELAY_MS: 800ms provides quick retries while avoiding rate limiting
 * - QUERY_TIMEOUT_MS: 8000ms accommodates slower networks without blocking indefinitely
 * 
 * Historical adjustments:
 * - MAX_RETRIES: 5 → 4 (reduced to fail faster for unrecoverable errors)
 * - RETRY_DELAY_MS: 1000ms → 800ms (optimized for mobile network conditions)
 * - QUERY_TIMEOUT_MS: 5000ms → 8000ms (increased for first-time OAuth profile creation)
 */
const MAX_RETRIES = 4; // Allow up to 4 attempts (0,1,2,3): initial + 3 retries
const RETRY_DELAY_MS = 800;
const QUERY_TIMEOUT_MS = 8000;

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

  // Fetch user profile from database with retry logic for race conditions
  const fetchProfile = async (userId: string, retryCount = 0): Promise<Profile | null> => {
    try {
      authLogger.info('👤 [fetchProfile] Querying profiles table for:', userId, retryCount > 0 ? `(Retry ${retryCount}/${MAX_RETRIES})` : '');
      
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
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          return fetchProfile(userId, retryCount + 1);
        }
        
        return null;
      }

      // Handle array response from .limit(1) instead of .single()
      const profileData = Array.isArray(data) ? data[0] : data;
      
      if (!profileData) {
        // Profile not found - could be a race condition with trigger
        if (retryCount < MAX_RETRIES) {
          authLogger.warn(`⚠️ [fetchProfile] Profile NOT FOUND yet (attempt ${retryCount + 1}/${MAX_RETRIES + 1}). Waiting for trigger to complete...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          return fetchProfile(userId, retryCount + 1);
        }
        
        authLogger.error('❌ [fetchProfile] Profile NOT FOUND after all retries! This should never happen with OAuth.');
        return null;
      }

      authLogger.info('✅ [fetchProfile] Profile found:', { username: profileData?.username, id: userId });
      return profileData;
    } catch (error: any) {
      // Check if it's a timeout
      if (error?.message === 'QUERY_TIMEOUT') {
        authLogger.error(`❌ [fetchProfile] Query TIMED OUT after ${QUERY_TIMEOUT_MS}ms!`);
        if (retryCount < MAX_RETRIES) {
          authLogger.warn(`⏳ [fetchProfile] Retrying after timeout (attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          return fetchProfile(userId, retryCount + 1);
        } else {
          authLogger.error('❌ [fetchProfile] GIVING UP after all retries. Network issue or Supabase not responding.');
          // Return null to allow app to continue loading without profile
          return null;
        }
      }
      authLogger.error('❌ [fetchProfile] Unexpected error:', error?.message || error?.code || String(error));
      return null;
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

      // 🔧 FIX: Ignore ALL INITIAL_SESSION events - handled by initializeAuth
      // The initialization code above already handles the initial session fetch and profile loading
      // This prevents race conditions where both init and onAuthStateChange try to load profile
      // 
      // NOTE: This pattern is safe because:
      // 1. User sign-ins trigger SIGNED_IN event, not INITIAL_SESSION
      // 2. initializeAuth() runs once on mount and handles restored sessions
      // 3. If component remounts, initializeAuth() runs again properly
      if (_event === 'INITIAL_SESSION') {
        authLogger.info('⏭️ [AuthContext] Skipping INITIAL_SESSION event (handled by initialization)');
        return;
      }

      if (mounted) {
        // CRITICAL: Keep loading state until profile is fetched
        // This prevents UI from rendering before profile data is ready
        // Only do this for non-INITIAL_SESSION events (sign in, token refresh, etc.)
        if (newSession?.user) {
          authLogger.info('⏳ [AuthContext] Session detected, keeping loading state until profile is ready...');
          setIsLoading(true);
        }

        authLogger.info('🔄 [AuthContext] Setting session state...', { hasSession: !!newSession });
        setSession(newSession);
        setUser(newSession?.user ?? null);

        // Fetch profile when session changes
        let profileData = null;
        if (newSession?.user) {
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
          } catch (fetchError: any) {
            authLogger.error('❌ [AuthContext] CRITICAL: Profile fetch threw exception:', fetchError?.message);
            setProfile(null);
          } finally {
            // CRITICAL: ALWAYS clear loading state, even if profile fetch fails
            // This prevents infinite loading screen
            setIsLoading(false);
            authLogger.info('✅ [AuthContext] Profile fetch complete, clearing loading state');
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

  // Sign out function
  // ENHANCED: Clean up room_players entries on sign-out to prevent username conflicts
  const signOut = async () => {
    try {
      const currentUserId = user?.id;
      
      // CRITICAL: Clean up room_players entries BEFORE signing out
      // This prevents stale username entries that block future sign-ins
      if (currentUserId) {
        authLogger.info('🧹 [AuthContext] Cleaning up user data before sign-out');
        
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
