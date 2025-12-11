import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { RoomPlayerWithRoom } from '../types';
import { authLogger, roomLogger } from '../utils/logger';

export interface Profile {
  id: string;
  username?: string;
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

  // Fetch user profile from database
  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        authLogger.error('Error fetching profile:', error?.message || error?.code || 'Unknown error');
        return null;
      }

      return data;
    } catch (error: any) {
      authLogger.error('Error fetching profile:', error?.message || error?.code || String(error));
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

      // Remove user from 'waiting' rooms only (future-proof for game persistence)
      const waitingRoomIds = memberships
        .filter(rm => rm.rooms?.status === 'waiting')
        .map(rm => rm.room_id);

      if (waitingRoomIds.length === 0) {
        roomLogger.info('✅ [AuthContext] No stale (waiting) rooms to clean up');
      } else {
        const { error: deleteError } = await supabase
          .from('room_players')
          .delete()
          .eq('user_id', userId)
          .in('room_id', waitingRoomIds);

        if (deleteError) {
          roomLogger.error('❌ [AuthContext] Error removing stale memberships:', deleteError?.message || deleteError?.code || 'Unknown error');
        } else {
          roomLogger.info(`✅ [AuthContext] Successfully cleaned up ${waitingRoomIds.length} stale (waiting) room memberships`);
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
      authLogger.debug('Auth state changed:', { event: _event, session: sanitizedSession });

      if (mounted) {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        // Fetch profile when session changes
        if (newSession?.user) {
          const profileData = await fetchProfile(newSession.user.id);
          setProfile(profileData);
        } else {
          setProfile(null);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Sign out function
  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        // Only log error message to avoid exposing auth tokens/session data
        authLogger.error('Error signing out:', error?.message || String(error));
        throw error;
      }
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
