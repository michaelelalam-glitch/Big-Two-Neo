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
  CARD_SORT_ORDER: '@stephanos_card_sort_order',
  ANIMATION_SPEED: '@stephanos_animation_speed',
  AUTO_PASS_TIMER: '@stephanos_auto_pass_timer',
  PROFILE_VISIBILITY: '@stephanos_profile_visibility',
  SHOW_ONLINE_STATUS: '@stephanos_show_online_status',
  LANGUAGE: '@stephanos_language',
  AUDIO_ENABLED: '@stephanos_audio_enabled',
  AUDIO_VOLUME: '@stephanos_audio_volume',
  HAPTICS_ENABLED: '@stephanos_haptics_enabled',
  // Historically named and kept as 'big2-audio-settings' to preserve existing
  // users' persisted preferences across the brand rename (changing this key
  // would cause a full preferences reset for upgrading users).
  AUDIO_SETTINGS_PERSIST: 'big2-audio-settings',
  /** Explicit migration sentinel — written once after legacy AsyncStorage keys
   *  are imported into the user-preferences Zustand persist store (Task #647
   *  first-run migration). This dedicated key acts as a clear migration
   *  sentinel so migration logic does not rely on the existence of the
   *  `stephanos-audio-settings` persist blob, which may be created early by other
   *  screens via Zustand's persist middleware. */
  AUDIO_SETTINGS_MIGRATION_COMPLETE: '@stephanos_audio_settings_migrated',
  /** User's analytics + crash-reporting consent (Task #272 GDPR compliance).
   *  Stored as the string `"true"` or `"false"`. A missing key means the user
   *  has not yet been shown the consent modal. */
  ANALYTICS_CONSENT: '@stephanos_analytics_consent',
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
