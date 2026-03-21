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
      // Defaults (overridden by persisted values on rehydration)
      soundEnabled: true,
      vibrationEnabled: true,
      cardSortOrder: 'suit',
      animationSpeed: 'normal',
      autoPassTimer: '60',
      profileVisibility: true,
      showOnlineStatus: true,

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
      name: 'big2-audio-settings',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the data fields, not the action functions
      partialize: state => ({
        soundEnabled: state.soundEnabled,
        vibrationEnabled: state.vibrationEnabled,
        cardSortOrder: state.cardSortOrder,
        animationSpeed: state.animationSpeed,
        autoPassTimer: state.autoPassTimer,
        profileVisibility: state.profileVisibility,
        showOnlineStatus: state.showOnlineStatus,
      }),
    }
  )
);
