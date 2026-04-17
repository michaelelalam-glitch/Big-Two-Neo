/**
 * migrateLegacyUserPreferences — Task #647 one-time migration
 *
 * Imports legacy per-key AsyncStorage game/privacy preference settings
 * (cardSortOrder, animationSpeed, autoPassTimer, profileVisibility,
 * showOnlineStatus) into the Zustand persist store.
 * Writes an explicit migration sentinel (AUDIO_SETTINGS_MIGRATION_COMPLETE) on
 * completion so the migration never runs twice, reusing the existing sentinel
 * key name even though it now guards game/privacy preferences rather than
 * audio-specific settings.
 *
 * Exposed as a standalone function for unit-testability.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_KEYS } from './settings';
import type { CardSortOrder, AnimationSpeed, AutoPassTimer } from './settings';

// Legacy AsyncStorage keys used before the Big2 → Stephanos brand rename.
// These must remain hardcoded strings so migration can read data that was
// written before SETTINGS_KEYS values changed (Task #647).
const LEGACY_KEYS = {
  CARD_SORT_ORDER: '@big2_card_sort_order',
  ANIMATION_SPEED: '@big2_animation_speed',
  AUTO_PASS_TIMER: '@big2_auto_pass_timer',
  PROFILE_VISIBILITY: '@big2_profile_visibility',
  SHOW_ONLINE_STATUS: '@big2_show_online_status',
  AUDIO_SETTINGS_MIGRATION_COMPLETE: '@big2_audio_settings_migrated',
} as const;

export type MigrationData = Partial<{
  cardSortOrder: CardSortOrder;
  animationSpeed: AnimationSpeed;
  autoPassTimer: AutoPassTimer;
  profileVisibility: boolean;
  showOnlineStatus: boolean;
}>;

/**
 * Runs the one-time migration of individual legacy AsyncStorage keys into the
 * Zustand persist store. Resolves to `true` if migration ran, `false` if it
 * was skipped (marker already set).
 *
 * Only valid legacy values are imported; invalid or missing keys are ignored.
 */
export async function migrateLegacyUserPreferences(
  hydrate: (data: MigrationData) => void
): Promise<boolean> {
  // Check both the new sentinel (already-migrated users on Stephanos) and the
  // old sentinel (users migrated before the brand rename when the key was
  // still @big2_audio_settings_migrated).
  const [newSentinel, oldSentinel] = await AsyncStorage.multiGet([
    SETTINGS_KEYS.AUDIO_SETTINGS_MIGRATION_COMPLETE,
    LEGACY_KEYS.AUDIO_SETTINGS_MIGRATION_COMPLETE,
  ]);
  if (newSentinel[1] !== null || oldSentinel[1] !== null) return false;

  const VALID_CARD_SORT: string[] = ['suit', 'rank'];
  const VALID_ANIM_SPEED: string[] = ['slow', 'normal', 'fast'];
  const VALID_AUTO_PASS: string[] = ['disabled', '30', '60', '90'];

  const legacyKeys = [
    LEGACY_KEYS.CARD_SORT_ORDER,
    LEGACY_KEYS.ANIMATION_SPEED,
    LEGACY_KEYS.AUTO_PASS_TIMER,
    LEGACY_KEYS.PROFILE_VISIBILITY,
    LEGACY_KEYS.SHOW_ONLINE_STATUS,
  ];

  const legacyEntries = await AsyncStorage.multiGet(legacyKeys);
  const legacyMap = Object.fromEntries(legacyEntries) as Record<string, string | null>;

  const savedCardSort = legacyMap[LEGACY_KEYS.CARD_SORT_ORDER];
  const savedAnimSpeed = legacyMap[LEGACY_KEYS.ANIMATION_SPEED];
  const savedAutoPass = legacyMap[LEGACY_KEYS.AUTO_PASS_TIMER];
  const savedVisibility = legacyMap[LEGACY_KEYS.PROFILE_VISIBILITY];
  const savedOnlineStatus = legacyMap[LEGACY_KEYS.SHOW_ONLINE_STATUS];

  const migration: MigrationData = {};
  if (savedCardSort && VALID_CARD_SORT.includes(savedCardSort))
    migration.cardSortOrder = savedCardSort as CardSortOrder;
  if (savedAnimSpeed && VALID_ANIM_SPEED.includes(savedAnimSpeed))
    migration.animationSpeed = savedAnimSpeed as AnimationSpeed;
  if (savedAutoPass && VALID_AUTO_PASS.includes(savedAutoPass))
    migration.autoPassTimer = savedAutoPass as AutoPassTimer;
  // Accept only explicit 'true'/'false' to avoid migrating corrupted values.
  if (savedVisibility === 'true' || savedVisibility === 'false')
    migration.profileVisibility = savedVisibility === 'true';
  if (savedOnlineStatus === 'true' || savedOnlineStatus === 'false')
    migration.showOnlineStatus = savedOnlineStatus === 'true';

  if (Object.keys(migration).length > 0) hydrate(migration);

  // Remove legacy keys so they can't overwrite the persisted store on future
  // mounts. The Zustand persist layer now owns these values.
  await AsyncStorage.multiRemove([
    LEGACY_KEYS.CARD_SORT_ORDER,
    LEGACY_KEYS.ANIMATION_SPEED,
    LEGACY_KEYS.AUTO_PASS_TIMER,
    LEGACY_KEYS.PROFILE_VISIBILITY,
    LEGACY_KEYS.SHOW_ONLINE_STATUS,
  ]);

  // Write the marker so future mounts skip this block.
  await AsyncStorage.setItem(SETTINGS_KEYS.AUDIO_SETTINGS_MIGRATION_COMPLETE, '1');
  return true;
}
