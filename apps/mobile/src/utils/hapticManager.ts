/**
 * Haptic Feedback Manager
 * 
 * Manages haptic feedback (vibrations) for user interactions in the Big Two mobile game.
 * Provides consistent haptic responses across iOS and Android.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

// Haptic feedback types
export enum HapticType {
  LIGHT = 'light',               // Light tap (card selection)
  MEDIUM = 'medium',             // Medium impact (play button)
  HEAVY = 'heavy',               // Heavy impact (invalid move)
  SUCCESS = 'success',           // Success pattern (valid move)
  WARNING = 'warning',           // Warning pattern (pass)
  ERROR = 'error',               // Error pattern (invalid move)
  SELECTION = 'selection',       // UI selection feedback
}

// Settings key
const HAPTICS_ENABLED_KEY = '@big2_haptics_enabled';

class HapticManager {
  private hapticsEnabled: boolean = true;
  private initialized: boolean = false;

  /**
   * Initialize the haptic manager
   * Loads user preferences
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load user preference
      const enabledStr = await AsyncStorage.getItem(HAPTICS_ENABLED_KEY);
      this.hapticsEnabled = enabledStr !== null ? enabledStr === 'true' : true;

      this.initialized = true;
      console.log('[HapticManager] Initialized successfully', {
        enabled: this.hapticsEnabled,
      });
    } catch (error) {
      console.error('[HapticManager] Initialization failed:', error);
    }
  }

  /**
   * Trigger haptic feedback
   */
  async trigger(type: HapticType): Promise<void> {
    if (!this.hapticsEnabled) {
      return;
    }

    try {
      switch (type) {
        case HapticType.LIGHT:
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;

        case HapticType.MEDIUM:
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          break;

        case HapticType.HEAVY:
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          break;

        case HapticType.SUCCESS:
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;

        case HapticType.WARNING:
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          break;

        case HapticType.ERROR:
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          break;

        case HapticType.SELECTION:
          await Haptics.selectionAsync();
          break;

        default:
          console.warn(`[HapticManager] Unknown haptic type: ${type}`);
      }
    } catch (error) {
      console.error(`[HapticManager] Failed to trigger haptic ${type}:`, error);
    }
  }

  /**
   * Check if haptics are enabled
   */
  async isHapticsEnabled(): Promise<boolean> {
    return this.hapticsEnabled;
  }

  /**
   * Enable or disable haptics
   */
  async setHapticsEnabled(enabled: boolean): Promise<void> {
    this.hapticsEnabled = enabled;
    await AsyncStorage.setItem(HAPTICS_ENABLED_KEY, enabled.toString());
    console.log(`[HapticManager] Haptics ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get current haptics state
   */
  getState(): { enabled: boolean } {
    return {
      enabled: this.hapticsEnabled,
    };
  }

  /**
   * Convenience methods for common interactions
   */

  // Card selection feedback
  async cardSelect(): Promise<void> {
    await this.trigger(HapticType.LIGHT);
  }

  // Play card button feedback
  async playCard(): Promise<void> {
    await this.trigger(HapticType.MEDIUM);
  }

  // Pass button feedback
  async pass(): Promise<void> {
    await this.trigger(HapticType.WARNING);
  }

  // Invalid move feedback
  async invalidMove(): Promise<void> {
    await this.trigger(HapticType.ERROR);
  }

  // Valid move success feedback
  async success(): Promise<void> {
    await this.trigger(HapticType.SUCCESS);
  }

  // Generic selection feedback (buttons, settings)
  async selection(): Promise<void> {
    await this.trigger(HapticType.SELECTION);
  }
}

// Export singleton instance
export const hapticManager = new HapticManager();
