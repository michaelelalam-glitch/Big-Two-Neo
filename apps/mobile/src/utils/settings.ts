/**
 * Settings utilities and exports
 *
 * Central export point for settings-related types, constants, and utilities
 */

// Settings types
export type CardSortOrder = 'suit' | 'rank';
export type AnimationSpeed = 'slow' | 'normal' | 'fast';
export type AutoPassTimer = 'disabled' | '30' | '60' | '90';

// Settings storage keys
export const SETTINGS_KEYS = {
  CARD_SORT_ORDER: '@big2_card_sort_order',
  ANIMATION_SPEED: '@big2_animation_speed',
  AUTO_PASS_TIMER: '@big2_auto_pass_timer',
  PROFILE_VISIBILITY: '@big2_profile_visibility',
  SHOW_ONLINE_STATUS: '@big2_show_online_status',
  LANGUAGE: '@big2_language',
  AUDIO_ENABLED: '@big2_audio_enabled',
  AUDIO_VOLUME: '@big2_audio_volume',
  HAPTICS_ENABLED: '@big2_haptics_enabled',
  /** Zustand persist storage key for the audio-settings slice (Task #647) */
  AUDIO_SETTINGS_PERSIST: 'big2-audio-settings',
  /** Explicit migration sentinel — written once after legacy AsyncStorage keys
   *  are imported into the Zustand persist store (Task #647 first-run migration).
   *  This dedicated key acts as a clear migration sentinel so migration logic
   *  does not rely on the existence of the `big2-audio-settings` persist blob,
   *  which may be created early by other screens via Zustand's persist middleware. */
  AUDIO_SETTINGS_MIGRATION_COMPLETE: '@big2_audio_settings_migrated',
} as const;

// Default settings values
export const DEFAULT_SETTINGS = {
  cardSortOrder: 'suit' as const,
  animationSpeed: 'normal' as const,
  autoPassTimer: '60' as const,
  profileVisibility: true,
  showOnlineStatus: true,
  language: 'en' as const,
  audioEnabled: true,
  audioVolume: 0.7,
  hapticsEnabled: true,
} as const;
