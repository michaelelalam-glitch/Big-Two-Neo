/**
 * audioSettingsSlice — Task #647: Expand Zustand store
 *
 * Source-of-truth for all user-configurable audio and game preference settings.
 * Replaces the scattered useState + AsyncStorage pattern in SettingsScreen and
 * GameSettingsModal.
 *
 * Persistence: uses Zustand `persist` middleware backed by AsyncStorage so
 * settings survive app restarts without a separate loadSettings() async call.
 *
 * NOTE: `soundManager` and `hapticManager` singletons still manage their own
 * in-memory state (and handle the actual playback / vibration logic). When a
 * setting is toggled via this store, callers must also call the corresponding
 * manager method so both sources stay in sync. A future cleanup can make the
 * managers fully reactive to this store.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_KEYS, DEFAULT_SETTINGS } from '../utils/settings';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CardSortOrder = 'suit' | 'rank';
export type AnimationSpeed = 'slow' | 'normal' | 'fast';
export type AutoPassTimer = 'disabled' | '30' | '60' | '90';

export interface AudioSettingsState {
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
        AudioSettingsState,
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

export const useAudioSettingsStore = create<AudioSettingsState>()(
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

      setSoundEnabled: enabled => set({ soundEnabled: enabled }),
      setVibrationEnabled: enabled => set({ vibrationEnabled: enabled }),
      setCardSortOrder: order => set({ cardSortOrder: order }),
      setAnimationSpeed: speed => set({ animationSpeed: speed }),
      setAutoPassTimer: timer => set({ autoPassTimer: timer }),
      setProfileVisibility: visible => set({ profileVisibility: visible }),
      setShowOnlineStatus: show => set({ showOnlineStatus: show }),

      hydrate: partial => set(partial),
    }),
    {
      // Central constant so the key stays in sync with migration/clear-cache code
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
