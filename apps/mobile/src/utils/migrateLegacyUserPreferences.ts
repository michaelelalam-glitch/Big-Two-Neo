/**
 * migrateLegacyUserPreferences — Task #647 one-time migration
 *
 * Imports legacy per-key AsyncStorage game/privacy preference settings
 * (cardSortOrder, animationSpeed, autoPassTimer, profileVisibility,
 * showOnlineStatus) into the Zustand persist store.
 * Writes an explicit migration sentinel (AUDIO_SETTINGS_MIGRATION_COMPLETE) on
 * completion so the migration never runs twice.
 *
 * Exposed as a standalone function for unit-testability.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_KEYS } from './settings';
import type { CardSortOrder, AnimationSpeed, AutoPassTimer } from './settings';

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
  const alreadyMigrated = await AsyncStorage.getItem(
    SETTINGS_KEYS.AUDIO_SETTINGS_MIGRATION_COMPLETE
  );
  if (alreadyMigrated !== null) return false;

  const VALID_CARD_SORT: string[] = ['suit', 'rank'];
  const VALID_ANIM_SPEED: string[] = ['slow', 'normal', 'fast'];
  const VALID_AUTO_PASS: string[] = ['disabled', '30', '60', '90'];

  const savedCardSort = await AsyncStorage.getItem(SETTINGS_KEYS.CARD_SORT_ORDER);
  const savedAnimSpeed = await AsyncStorage.getItem(SETTINGS_KEYS.ANIMATION_SPEED);
  const savedAutoPass = await AsyncStorage.getItem(SETTINGS_KEYS.AUTO_PASS_TIMER);
  const savedVisibility = await AsyncStorage.getItem(SETTINGS_KEYS.PROFILE_VISIBILITY);
  const savedOnlineStatus = await AsyncStorage.getItem(SETTINGS_KEYS.SHOW_ONLINE_STATUS);

  const migration: MigrationData = {};
  if (savedCardSort && VALID_CARD_SORT.includes(savedCardSort))
    migration.cardSortOrder = savedCardSort as CardSortOrder;
  if (savedAnimSpeed && VALID_ANIM_SPEED.includes(savedAnimSpeed))
    migration.animationSpeed = savedAnimSpeed as AnimationSpeed;
  if (savedAutoPass && VALID_AUTO_PASS.includes(savedAutoPass))
    migration.autoPassTimer = savedAutoPass as AutoPassTimer;
  if (savedVisibility !== null) migration.profileVisibility = savedVisibility === 'true';
  if (savedOnlineStatus !== null) migration.showOnlineStatus = savedOnlineStatus === 'true';

  if (Object.keys(migration).length > 0) hydrate(migration);

  // Remove legacy keys so they can't overwrite the persisted store on future
  // mounts. The Zustand persist layer now owns these values.
  await AsyncStorage.multiRemove([
    SETTINGS_KEYS.CARD_SORT_ORDER,
    SETTINGS_KEYS.ANIMATION_SPEED,
    SETTINGS_KEYS.AUTO_PASS_TIMER,
    SETTINGS_KEYS.PROFILE_VISIBILITY,
    SETTINGS_KEYS.SHOW_ONLINE_STATUS,
  ]);

  // Write the marker so future mounts skip this block.
  await AsyncStorage.setItem(SETTINGS_KEYS.AUDIO_SETTINGS_MIGRATION_COMPLETE, '1');
  return true;
}
