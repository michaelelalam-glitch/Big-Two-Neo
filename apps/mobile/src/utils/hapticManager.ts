/**
 * Haptic Feedback Manager
 * 
 * Manages haptic feedback (vibrations) for user interactions in the Big Two mobile game.
 * Provides consistent haptic responses across iOS and Android.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { uiLogger } from './logger';

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
      uiLogger.info('[HapticManager] Initialized successfully', {
        enabled: this.hapticsEnabled,
      });
    } catch (error) {
      uiLogger.error('[HapticManager] Initialization failed:', error);
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
          uiLogger.warn(`[HapticManager] Unknown haptic type: ${type}`);
      }
    } catch (error) {
      uiLogger.error(`[HapticManager] Failed to trigger haptic ${type}:`, error);
    }
  }

  /**
   * Check if haptics are enabled
   */
  isHapticsEnabled(): boolean {
    return this.hapticsEnabled;
  }

  /**
   * Enable or disable haptics
   */
  async setHapticsEnabled(enabled: boolean): Promise<void> {
    this.hapticsEnabled = enabled;
    await AsyncStorage.setItem(HAPTICS_ENABLED_KEY, enabled.toString());
    uiLogger.info(`[HapticManager] Haptics ${enabled ? 'enabled' : 'disabled'}`);
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

  /**
   * Progressive urgency vibration for auto-pass timer
   * Uses multiple rapid pulses to create increasing intensity
   * @param secondsRemaining - Seconds remaining (5, 4, 3, 2, 1)
   */
  async urgentCountdown(secondsRemaining: number): Promise<void> {
    if (!this.hapticsEnabled) return;

    try {
      // More pulses = more intense feeling
      let pulseCount: number;
      let baseIntensity: Haptics.ImpactFeedbackStyle;
      let delayBetweenPulses: number;

      switch (secondsRemaining) {
        case 5:
          pulseCount = 1; // Single light pulse
          baseIntensity = Haptics.ImpactFeedbackStyle.Light;
          delayBetweenPulses = 0;
          break;
        
        case 4:
          pulseCount = 2; // Double medium pulse
          baseIntensity = Haptics.ImpactFeedbackStyle.Medium;
          delayBetweenPulses = 50; // 50ms between pulses
          break;
        
        case 3:
          pulseCount = 3; // Triple heavy pulse
          baseIntensity = Haptics.ImpactFeedbackStyle.Heavy;
          delayBetweenPulses = 60; // 60ms between pulses
          break;
        
        case 2:
          pulseCount = 4; // Quad heavy pulse (more intense)
          baseIntensity = Haptics.ImpactFeedbackStyle.Heavy;
          delayBetweenPulses = 70; // 70ms between pulses
          break;
        
        case 1:
          pulseCount = 5; // Quintuple heavy pulse (most intense)
          baseIntensity = Haptics.ImpactFeedbackStyle.Heavy;
          delayBetweenPulses = 80; // 80ms between pulses
          break;
        
        default:
          return; // Invalid seconds value
      }

      // Fire multiple pulses with delays
      for (let i = 0; i < pulseCount; i++) {
        await Haptics.impactAsync(baseIntensity);
        
        // Wait between pulses (except after the last one)
        if (i < pulseCount - 1) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenPulses));
        }
      }
      
      uiLogger.debug(`[HapticManager] Urgent countdown: ${secondsRemaining}s (${pulseCount} pulses)`);
    } catch (error) {
      uiLogger.error(`[HapticManager] Failed to trigger urgent countdown:`, error);
    }
  }
}

// Export singleton instance
export const hapticManager = new HapticManager();
