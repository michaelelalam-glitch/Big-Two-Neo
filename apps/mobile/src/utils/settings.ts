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
