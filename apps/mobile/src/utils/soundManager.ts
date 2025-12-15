/**
 * Sound Manager
 * 
 * Manages all audio playback in the Big Two mobile game.
 * Handles loading, playing, and managing sound effects with settings integration.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';

// Sound types
export enum SoundType {
  GAME_START = 'game_start',           // fi_mat3am_hawn - plays when game initializes
  HIGHEST_CARD = 'highest_card',       // Yeyyeeyy - plays when highest card/combo is played
  CARD_PLAY = 'card_play',             // Generic card play sound
  PASS = 'pass',                       // Pass turn sound
  WIN = 'win',                         // Match/game win sound
  LOSE = 'lose',                       // Match/game lose sound
  TURN_NOTIFICATION = 'turn_notification', // Your turn indicator
  INVALID_MOVE = 'invalid_move',       // Invalid move attempt
}

// Sound file paths
const SOUND_FILES: Record<SoundType, any> = {
  [SoundType.GAME_START]: require('../../assets/sounds/fi_mat3am_hawn.m4a'),
  [SoundType.HIGHEST_CARD]: require('../../assets/sounds/Yeyyeeyy.m4a'),
  [SoundType.CARD_PLAY]: null, // TODO: Add generic card play sound
  [SoundType.PASS]: null,
  [SoundType.WIN]: null,
  [SoundType.LOSE]: null,
  [SoundType.TURN_NOTIFICATION]: null,
  [SoundType.INVALID_MOVE]: null,
};

// Settings keys
const AUDIO_ENABLED_KEY = '@big2_audio_enabled';
const AUDIO_VOLUME_KEY = '@big2_audio_volume';

class SoundManager {
  private sounds: Map<SoundType, any> = new Map(); // Use 'any' since Audio can be null
  private audioEnabled: boolean = true;
  private volume: number = 0.7; // Default 70% volume
  private initialized: boolean = false;

  /**
   * Initialize the sound manager
   * Loads user preferences and prepares audio system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Configure audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      // Load user preferences
      await this.loadSettings();

      // Preload critical sounds
      await this.preloadSound(SoundType.GAME_START);
      await this.preloadSound(SoundType.HIGHEST_CARD);

      this.initialized = true;
      console.log('[SoundManager] Initialized successfully');
    } catch (error) {
      console.error('[SoundManager] Initialization failed:', error);
      this.initialized = true; // Mark as initialized to prevent retry loops
    }
  }

  /**
   * Load settings from AsyncStorage
   */
  private async loadSettings(): Promise<void> {
    try {
      const [enabledStr, volumeStr] = await Promise.all([
        AsyncStorage.getItem(AUDIO_ENABLED_KEY),
        AsyncStorage.getItem(AUDIO_VOLUME_KEY),
      ]);

      this.audioEnabled = enabledStr !== null ? enabledStr === 'true' : true;
      this.volume = volumeStr !== null ? parseFloat(volumeStr) : 0.7;

      console.log('[SoundManager] Settings loaded:', {
        enabled: this.audioEnabled,
        volume: this.volume,
      });
    } catch (error) {
      console.error('[SoundManager] Failed to load settings:', error);
    }
  }

  /**
   * Preload a sound file
   */
  private async preloadSound(type: SoundType): Promise<void> {
    const soundFile = SOUND_FILES[type];
    if (!soundFile) return;

    try {
      const { sound } = await Audio.Sound.createAsync(soundFile, {
        shouldPlay: false,
        volume: this.volume,
      });

      this.sounds.set(type, sound);
      console.log(`[SoundManager] Preloaded sound: ${type}`);
    } catch (error) {
      console.error(`[SoundManager] Failed to preload sound ${type}:`, error);
    }
  }

  /**
   * Play a sound effect
   */
  async playSound(type: SoundType): Promise<void> {
    if (!this.audioEnabled) {
      console.log(`[SoundManager] Audio disabled, skipping: ${type}`);
      return;
    }

    try {
      let sound = this.sounds.get(type);

      // If not preloaded, load it now
      if (!sound) {
        const soundFile = SOUND_FILES[type];
        if (!soundFile) {
          console.warn(`[SoundManager] No sound file for: ${type}`);
          return;
        }

        const { sound: newSound } = await Audio.Sound.createAsync(soundFile, {
          shouldPlay: false,
          volume: this.volume,
        });

        sound = newSound;
        this.sounds.set(type, sound);
      }

      // Stop if already playing
      const status = await sound.getStatusAsync();
      if (status.isLoaded && status.isPlaying) {
        await sound.stopAsync();
      }

      // Replay from start
      await sound.replayAsync();
      console.log(`[SoundManager] Played sound: ${type}`);
    } catch (error) {
      console.error(`[SoundManager] Failed to play sound ${type}:`, error);
    }
  }

  /**
   * Check if audio is enabled
   */
  async isAudioEnabled(): Promise<boolean> {
    return this.audioEnabled;
  }

  /**
   * Enable or disable audio
   */
  async setAudioEnabled(enabled: boolean): Promise<void> {
    this.audioEnabled = enabled;
    await AsyncStorage.setItem(AUDIO_ENABLED_KEY, enabled.toString());
    console.log(`[SoundManager] Audio ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  async setVolume(volume: number): Promise<void> {
    this.volume = Math.max(0, Math.min(1, volume));
    await AsyncStorage.setItem(AUDIO_VOLUME_KEY, this.volume.toString());

    // Update all loaded sounds
    for (const [, sound] of this.sounds) {
      try {
        await sound.setVolumeAsync(this.volume);
      } catch (error) {
        console.error('[SoundManager] Failed to update volume:', error);
      }
    }

    console.log(`[SoundManager] Volume set to: ${this.volume}`);
  }

  /**
   * Get current audio state
   */
  getState(): { enabled: boolean; volume: number } {
    return {
      enabled: this.audioEnabled,
      volume: this.volume,
    };
  }

  /**
   * Cleanup all sounds
   */
  async cleanup(): Promise<void> {
    console.log('[SoundManager] Cleaning up sounds...');

    for (const [type, sound] of this.sounds) {
      try {
        await sound.unloadAsync();
        console.log(`[SoundManager] Unloaded sound: ${type}`);
      } catch (error) {
        console.error(`[SoundManager] Failed to unload sound ${type}:`, error);
      }
    }

    this.sounds.clear();
    this.initialized = false;
  }
}

// Export singleton instance
export const soundManager = new SoundManager();
