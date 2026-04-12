/**
 * userPreferencesSlice — Task #647: Expand Zustand store
 *
 * Source-of-truth for persisted, user-configurable game preference settings
 * (cardSortOrder, animationSpeed, autoPassTimer, profileVisibility,
 * showOnlineStatus) that survive app
 * restarts via Zustand `persist` middleware.
 * Replaces the scattered useState + AsyncStorage pattern in SettingsScreen and
 * GameSettingsModal.
 *
 * soundEnabled / vibrationEnabled are held in-memory for UI purposes only and
 * are intentionally excluded from Zustand persistence (partialize). The
 * `soundManager` and `hapticManager` singletons remain the authoritative
 * persisted source for those two flags; this slice's setSoundEnabled /
 * setVibrationEnabled actions update Zustand in-memory state AND fire a
 * fire-and-forget sync to the respective manager so both sources stay in sync
 * without callers needing to remember a separate manager call.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_KEYS, DEFAULT_SETTINGS } from '../utils/settings';
import { soundManager } from '../utils/soundManager';
import { hapticManager } from '../utils/hapticManager';
import { uiLogger } from '../utils/logger';
import { supabase } from '../services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────
// Imported from the central settings utility to avoid type drift.
import type { CardSortOrder, AnimationSpeed, AutoPassTimer } from '../utils/settings';

// P12-H1: Fire-and-forget sync of notification preferences to the profiles
// table so the send-push-notification edge function can enforce opt-out
// server-side (including background/killed-state notifications).
function _syncNotifyPreferenceToDb(column: string, value: boolean) {
  supabase.auth
    .getUser()
    .then(({ data }) => {
      if (!data?.user) return;
      supabase
        .from('profiles')
        .update({ [column]: value })
        .eq('id', data.user.id)
        .then(({ error }) => {
          if (error) uiLogger.error(`[UserPreferences] Failed to sync ${column} to DB`, error);
        });
    })
    .catch(() => {
      /* no-op if not authed */
    });
}
export type { CardSortOrder, AnimationSpeed, AutoPassTimer };

export type ProfilePhotoSize = 'small' | 'medium' | 'large';

export interface UserPreferencesState {
  // Audio & haptics
  soundEnabled: boolean;
  vibrationEnabled: boolean;

  // Game preferences
  cardSortOrder: CardSortOrder;
  animationSpeed: AnimationSpeed;
  autoPassTimer: AutoPassTimer;

  // Privacy
  profileVisibility: boolean;
  showOnlineStatus: boolean;

  // Notification type preferences
  notifyGameInvites: boolean;
  notifyYourTurn: boolean;
  notifyGameStarted: boolean;
  notifyFriendRequests: boolean;

  // Display
  profilePhotoSize: ProfilePhotoSize;

  // Actions
  setSoundEnabled: (enabled: boolean) => void;
  setVibrationEnabled: (enabled: boolean) => void;
  setCardSortOrder: (order: CardSortOrder) => void;
  setAnimationSpeed: (speed: AnimationSpeed) => void;
  setAutoPassTimer: (timer: AutoPassTimer) => void;
  setProfileVisibility: (visible: boolean) => void;
  setShowOnlineStatus: (show: boolean) => void;
  setProfilePhotoSize: (size: ProfilePhotoSize) => void;
  setNotifyGameInvites: (enabled: boolean) => void;
  setNotifyYourTurn: (enabled: boolean) => void;
  setNotifyGameStarted: (enabled: boolean) => void;
  setNotifyFriendRequests: (enabled: boolean) => void;
  /** Hydrate the store from existing manager/AsyncStorage values on first mount */
  hydrate: (
    partial: Partial<
      Omit<
        UserPreferencesState,
        | 'setSoundEnabled'
        | 'setVibrationEnabled'
        | 'setCardSortOrder'
        | 'setAnimationSpeed'
        | 'setAutoPassTimer'
        | 'setProfileVisibility'
        | 'setShowOnlineStatus'
        | 'setProfilePhotoSize'
        | 'setNotifyGameInvites'
        | 'setNotifyYourTurn'
        | 'setNotifyGameStarted'
        | 'setNotifyFriendRequests'
        | 'hydrate'
      >
    >
  ) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useUserPreferencesStore = create<UserPreferencesState>()(
  persist(
    set => ({
      // Defaults — sourced from DEFAULT_SETTINGS to keep a single source of truth.
      // These are the initial in-memory values; persisted fields are overridden
      // by Zustand rehydration on subsequent app launches.
      soundEnabled: DEFAULT_SETTINGS.audioEnabled,
      vibrationEnabled: DEFAULT_SETTINGS.hapticsEnabled,
      cardSortOrder: DEFAULT_SETTINGS.cardSortOrder,
      animationSpeed: DEFAULT_SETTINGS.animationSpeed,
      autoPassTimer: DEFAULT_SETTINGS.autoPassTimer,
      profileVisibility: DEFAULT_SETTINGS.profileVisibility,
      showOnlineStatus: DEFAULT_SETTINGS.showOnlineStatus,
      notifyGameInvites: true,
      notifyYourTurn: true,
      notifyGameStarted: true,
      notifyFriendRequests: true,
      profilePhotoSize: 'medium' as ProfilePhotoSize,

      setSoundEnabled: enabled => {
        // Optimistic update: mirrors SoundManager's own in-memory flag mutation
        // (which happens before the AsyncStorage write inside setAudioEnabled).
        // Both sources are set to the new state immediately; a persistence
        // failure is logged but intentionally does not revert either source,
        // keeping them consistent with each other.
        set({ soundEnabled: enabled });
        void soundManager
          .setAudioEnabled(enabled)
          .catch(err => uiLogger.error('[UserPreferences] Failed to persist audio enabled', err));
      },
      setVibrationEnabled: enabled => {
        set({ vibrationEnabled: enabled });
        void hapticManager
          .setHapticsEnabled(enabled)
          .catch(err => uiLogger.error('[UserPreferences] Failed to persist haptics enabled', err));
      },
      setCardSortOrder: order => set({ cardSortOrder: order }),
      setAnimationSpeed: speed => set({ animationSpeed: speed }),
      setAutoPassTimer: timer => set({ autoPassTimer: timer }),
      setProfileVisibility: visible => set({ profileVisibility: visible }),
      setShowOnlineStatus: show => set({ showOnlineStatus: show }),
      setProfilePhotoSize: size => set({ profilePhotoSize: size }),
      setNotifyGameInvites: enabled => {
        set({ notifyGameInvites: enabled });
        _syncNotifyPreferenceToDb('notify_game_invites', enabled);
      },
      setNotifyYourTurn: enabled => {
        set({ notifyYourTurn: enabled });
        _syncNotifyPreferenceToDb('notify_your_turn', enabled);
      },
      setNotifyGameStarted: enabled => set({ notifyGameStarted: enabled }),
      setNotifyFriendRequests: enabled => set({ notifyFriendRequests: enabled }),

      hydrate: partial => set(partial),
    }),
    {
      // Historically named 'big2-audio-settings'; now backs the full
      // user-preferences blob (card sort, animation speed, auto-pass timer,
      // privacy flags). Central constant so the key stays in sync with
      // migration/clear-cache code.
      name: SETTINGS_KEYS.AUDIO_SETTINGS_PERSIST,
      storage: createJSONStorage(() => AsyncStorage),
      // Schema version — increment when adding/removing persisted fields (M30).
      // The migrate function handles upgrading stored data from older schema
      // versions so existing users don't lose their preferences after an update.
      version: 1,
      migrate: (persistedState: unknown, version: number): UserPreferencesState => {
        // Guard against null/undefined/corrupted AsyncStorage — return an empty
        // object so Zustand merges it with the store's initial defaults rather
        // than crashing on a bad cast.
        const safe =
          typeof persistedState === 'object' && persistedState !== null
            ? (persistedState as Partial<UserPreferencesState>)
            : {};
        if (version === 0) {
          // v0 → v1: no structural changes yet; merge persisted data over defaults.
          // Double-cast via unknown makes the intentional partial→full type coercion
          // explicit: Zustand merges this partial with the in-memory state (keeping
          // action functions from the default store).
          return safe as unknown as UserPreferencesState;
        }
        return safe as unknown as UserPreferencesState;
      },
      // Only persist the data fields, not the action functions.
      // soundEnabled/vibrationEnabled are excluded: they're owned by the
      // soundManager/hapticManager singletons (which have their own
      // AsyncStorage persistence), so including them here would create two
      // competing persisted sources and a rehydration race.
      partialize: state => ({
        cardSortOrder: state.cardSortOrder,
        animationSpeed: state.animationSpeed,
        autoPassTimer: state.autoPassTimer,
        profileVisibility: state.profileVisibility,
        showOnlineStatus: state.showOnlineStatus,
        profilePhotoSize: state.profilePhotoSize,
        notifyGameInvites: state.notifyGameInvites,
        notifyYourTurn: state.notifyYourTurn,
        notifyGameStarted: state.notifyGameStarted,
        notifyFriendRequests: state.notifyFriendRequests,
      }),
    }
  )
);

// ── P4-M1: Hydration gate ──────────────────────────────────────────────────
// Zustand persist rehydrates from AsyncStorage asynchronously. Reads before
// hydration completes return the in-memory defaults, not the user's saved
// preferences. Expose a promise + boolean so callers can await or guard.
let _resolveHydration: () => void;
export const userPreferencesHydrated = new Promise<void>(r => {
  _resolveHydration = r;
});
export let isUserPreferencesHydrated = false;
useUserPreferencesStore.persist.onFinishHydration(() => {
  isUserPreferencesHydrated = true;
  _resolveHydration();
});
