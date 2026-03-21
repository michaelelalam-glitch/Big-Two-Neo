/**
 * userPreferencesSlice — Task #647: Expand Zustand store
 *
 * Source-of-truth for persisted, user-configurable game preference settings
 * (cardSortOrder, animationSpeed, autoPassTimer, profileVisibility,
 * showOnlineStatus) that survive app restarts via Zustand `persist` middleware.
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

// ─── Types ────────────────────────────────────────────────────────────────────
// Imported from the central settings utility to avoid type drift.
import type { CardSortOrder, AnimationSpeed, AutoPassTimer } from '../utils/settings';
export type { CardSortOrder, AnimationSpeed, AutoPassTimer };

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

  // Actions
  setSoundEnabled: (enabled: boolean) => void;
  setVibrationEnabled: (enabled: boolean) => void;
  setCardSortOrder: (order: CardSortOrder) => void;
  setAnimationSpeed: (speed: AnimationSpeed) => void;
  setAutoPassTimer: (timer: AutoPassTimer) => void;
  setProfileVisibility: (visible: boolean) => void;
  setShowOnlineStatus: (show: boolean) => void;
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

      setSoundEnabled: enabled => {
        set({ soundEnabled: enabled });
        void soundManager.setAudioEnabled(enabled).catch(err => {
          console.error('[UserPreferences] Failed to persist audio enabled', err);
          // Rollback optimistic update so UI stays consistent with manager
          set({ soundEnabled: !enabled });
        });
      },
      setVibrationEnabled: enabled => {
        set({ vibrationEnabled: enabled });
        void hapticManager.setHapticsEnabled(enabled).catch(err => {
          console.error('[UserPreferences] Failed to persist haptics enabled', err);
          // Rollback optimistic update so UI stays consistent with manager
          set({ vibrationEnabled: !enabled });
        });
      },
      setCardSortOrder: order => set({ cardSortOrder: order }),
      setAnimationSpeed: speed => set({ animationSpeed: speed }),
      setAutoPassTimer: timer => set({ autoPassTimer: timer }),
      setProfileVisibility: visible => set({ profileVisibility: visible }),
      setShowOnlineStatus: show => set({ showOnlineStatus: show }),

      hydrate: partial => set(partial),
    }),
    {
      // Historically named 'big2-audio-settings'; now backs the full
      // user-preferences blob (card sort, animation speed, auto-pass timer,
      // privacy flags). Central constant so the key stays in sync with
      // migration/clear-cache code.
      name: SETTINGS_KEYS.AUDIO_SETTINGS_PERSIST,
      storage: createJSONStorage(() => AsyncStorage),
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
      }),
    }
  )
);
