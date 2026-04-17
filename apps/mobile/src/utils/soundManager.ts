/**
 * Sound Manager
 *
 * Manages all audio playback in the Stephanos mobile game.
 * Handles loading, playing, and managing sound effects with settings integration.
 *
 * Migrated from expo-av (deprecated) to expo-audio in SDK 54.
 * Reference: https://docs.expo.dev/versions/latest/sdk/audio/
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AudioPlayer } from 'expo-audio';
import { uiLogger } from './logger';

// Lazy-load expo-audio so a missing native module (e.g. old dev build) only
// disables audio rather than crashing the entire runtime.
// Metro transforms dynamic import() to synchronous require(), so we must use
// require() + try/catch — the only pattern that catches a missing native module
// before it propagates to the JS runtime and prevents the app from booting.
let _createAudioPlayer: typeof import('expo-audio').createAudioPlayer | null = null;
let _setAudioModeAsync: typeof import('expo-audio').setAudioModeAsync | null = null;
let _nativeModuleAvailable = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expoAudio = require('expo-audio') as typeof import('expo-audio');
  _createAudioPlayer = expoAudio.createAudioPlayer;
  _setAudioModeAsync = expoAudio.setAudioModeAsync;
  _nativeModuleAvailable = true;
} catch {
  uiLogger.warn('[SoundManager] expo-audio native module not available — audio disabled');
}

// Sound types
export enum SoundType {
  GAME_START = 'game_start', // fi_mat3am_hawn - plays when game initializes
  HIGHEST_CARD = 'highest_card', // Yeyyeeyy - plays when highest card/combo is played
  CARD_PLAY = 'card_play', // Generic card play sound
  PASS = 'pass', // Pass turn sound
  WIN = 'win', // Match/game win sound
  LOSE = 'lose', // Match/game lose sound
  TURN_NOTIFICATION = 'turn_notification', // Your turn indicator
  INVALID_MOVE = 'invalid_move', // Invalid move attempt
  CHAT_MESSAGE = 'chat_message', // Incoming chat message from another player
}

// Sound file paths
const SOUND_FILES: Record<SoundType, number> = {
  [SoundType.GAME_START]: require('../../assets/sounds/fi_mat3am_hawn.m4a'),
  [SoundType.HIGHEST_CARD]: require('../../assets/sounds/Yeyyeeyy.m4a'),
  [SoundType.CARD_PLAY]: require('../../assets/sounds/card_play.m4a'),
  [SoundType.PASS]: require('../../assets/sounds/pass.m4a'),
  [SoundType.WIN]: require('../../assets/sounds/win.m4a'),
  [SoundType.LOSE]: require('../../assets/sounds/lose.m4a'),
  [SoundType.TURN_NOTIFICATION]: require('../../assets/sounds/turn_notification.m4a'),
  [SoundType.INVALID_MOVE]: require('../../assets/sounds/invalid_move.m4a'),
  // Custom MP3 notification chime — unique and audibly distinct from pass.m4a.
  [SoundType.CHAT_MESSAGE]: require('../../assets/sounds/chat_notification.mp3'),
};

// Settings keys
const AUDIO_ENABLED_KEY = '@stephanos_audio_enabled';
const AUDIO_VOLUME_KEY = '@stephanos_audio_volume';

class SoundManager {
  private sounds: Map<SoundType, AudioPlayer> = new Map();
  private audioEnabled: boolean = true;
  private volume: number = 0.7; // Default 70% volume
  private initialized: boolean = false;
  private activePlayers: Set<AudioPlayer> = new Set(); // Track active player instances
  private readonly MAX_CONCURRENT_SOUNDS = 5; // Limit concurrent sounds to prevent memory pressure

  /**
   * Initialize the sound manager
   * Loads user preferences and prepares audio system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!_nativeModuleAvailable) {
      uiLogger.warn('[SoundManager] Skipping init — native module unavailable');
      this.initialized = true;
      return;
    }

    try {
      // Configure audio mode (expo-audio API)
      await _setAudioModeAsync!({
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
      });

      // Load user preferences
      await this.loadSettings();

      // Preload critical sounds
      await this.preloadSound(SoundType.GAME_START);
      await this.preloadSound(SoundType.HIGHEST_CARD);

      this.initialized = true;
      uiLogger.info('[SoundManager] Initialized successfully');
    } catch (error) {
      uiLogger.error('[SoundManager] Initialization failed:', error);
      this.initialized = true; // Mark as initialized to prevent retry loops
    }
  }

  /**
   * Load settings from AsyncStorage
   */
  private async loadSettings(): Promise<void> {
    try {
      let [enabledStr, volumeStr] = await Promise.all([
        AsyncStorage.getItem(AUDIO_ENABLED_KEY),
        AsyncStorage.getItem(AUDIO_VOLUME_KEY),
      ]);

      // Migrate legacy @big2_ keys for existing users upgrading from the old brand
      if (enabledStr === null) {
        const legacy = await AsyncStorage.getItem('@big2_audio_enabled');
        if (legacy !== null) {
          enabledStr = legacy;
          await Promise.all([
            AsyncStorage.setItem(AUDIO_ENABLED_KEY, legacy),
            AsyncStorage.removeItem('@big2_audio_enabled'),
          ]);
        }
      }
      if (volumeStr === null) {
        const legacy = await AsyncStorage.getItem('@big2_audio_volume');
        if (legacy !== null) {
          volumeStr = legacy;
          await Promise.all([
            AsyncStorage.setItem(AUDIO_VOLUME_KEY, legacy),
            AsyncStorage.removeItem('@big2_audio_volume'),
          ]);
        }
      }

      this.audioEnabled = enabledStr !== null ? enabledStr === 'true' : true;
      this.volume = volumeStr !== null ? parseFloat(volumeStr) : 0.7;

      uiLogger.debug('[SoundManager] Settings loaded:', {
        enabled: this.audioEnabled,
        volume: this.volume,
      });
    } catch (error) {
      uiLogger.error('[SoundManager] Failed to load settings:', error);
    }
  }

  /**
   * Preload a sound file
   */
  private async preloadSound(type: SoundType): Promise<void> {
    if (!_createAudioPlayer) return;
    const soundFile = SOUND_FILES[type];
    if (!soundFile) return;

    try {
      const player = _createAudioPlayer(soundFile);
      player.volume = this.volume;
      this.sounds.set(type, player);
      uiLogger.debug(`[SoundManager] Preloaded sound: ${type}`);
    } catch (error) {
      uiLogger.error(`[SoundManager] Failed to preload sound ${type}:`, error);
    }
  }

  /**
   * Play a sound effect.
   * Uses the preloaded player from initialize() when available.
   * Falls back to creating a transient AudioPlayer instance for non-preloaded sounds,
   * capped by MAX_CONCURRENT_SOUNDS to prevent memory pressure from rapid plays.
   */
  async playSound(type: SoundType): Promise<void> {
    if (!this.audioEnabled) {
      return;
    }

    try {
      const soundFile = SOUND_FILES[type];
      if (!soundFile) {
        uiLogger.warn(`[SoundManager] No sound file for: ${type}`);
        return;
      }

      // Use a preloaded player if one is cached — avoids allocating a new instance
      // Preloaded players do not count toward activePlayers, so the concurrency
      // limit should not block them.
      const preloaded = this.sounds.get(type);
      if (preloaded) {
        preloaded.volume = this.volume;
        // Seek back to the start so the sound replays from the beginning,
        // not from where it last stopped (which would be silent at EOF).
        await preloaded.seekTo(0);
        preloaded.play();
        uiLogger.debug(`[SoundManager] Played preloaded sound: ${type}`);
        return;
      }

      // Limit concurrent transient sounds to prevent memory pressure from rapid plays
      if (this.activePlayers.size >= this.MAX_CONCURRENT_SOUNDS) {
        uiLogger.warn(
          `[SoundManager] Max concurrent sounds (${this.MAX_CONCURRENT_SOUNDS}) reached, skipping: ${type}`
        );
        return;
      }

      // No preloaded player — create a new transient instance
      if (!_createAudioPlayer) return;
      const player = _createAudioPlayer(soundFile);
      player.volume = this.volume;
      this.activePlayers.add(player);

      player.play();
      uiLogger.debug(
        `[SoundManager] Played sound: ${type} (${this.activePlayers.size}/${this.MAX_CONCURRENT_SOUNDS} active)`
      );

      // Unload the player after playback finishes to prevent memory leaks
      const subscription = player.addListener('playbackStatusUpdate', status => {
        if (status.didJustFinish) {
          subscription.remove();
          this.activePlayers.delete(player);
          player.remove();
        }
      });
    } catch (error) {
      uiLogger.error(`[SoundManager] Failed to play sound ${type}:`, error);
    }
  }

  /**
   * Check if audio is enabled
   */
  isAudioEnabled(): boolean {
    return this.audioEnabled;
  }

  /**
   * Enable or disable audio
   */
  async setAudioEnabled(enabled: boolean): Promise<void> {
    this.audioEnabled = enabled;
    await AsyncStorage.setItem(AUDIO_ENABLED_KEY, enabled.toString());
    uiLogger.info(`[SoundManager] Audio ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  async setVolume(volume: number): Promise<void> {
    this.volume = Math.max(0, Math.min(1, volume));
    await AsyncStorage.setItem(AUDIO_VOLUME_KEY, this.volume.toString());

    // Update all loaded players
    for (const [, player] of this.sounds) {
      try {
        player.volume = this.volume;
      } catch (error) {
        uiLogger.error('[SoundManager] Failed to update volume:', error);
      }
    }

    uiLogger.info(`[SoundManager] Volume set to: ${this.volume}`);
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
    uiLogger.info('[SoundManager] Cleaning up sounds...');

    // Remove all active transient players first (player.remove() stops playback and deallocates)
    for (const player of this.activePlayers) {
      try {
        player.remove();
      } catch (error) {
        uiLogger.error('[SoundManager] Failed to remove active player during cleanup:', error);
      }
    }
    this.activePlayers.clear();

    // Remove preloaded players
    for (const [type, player] of this.sounds) {
      try {
        player.remove();
        uiLogger.debug(`[SoundManager] Removed player: ${type}`);
      } catch (error) {
        uiLogger.error(`[SoundManager] Failed to remove player ${type}:`, error);
      }
    }

    this.sounds.clear();
    this.initialized = false;
  }
}

// Export singleton instance
export const soundManager = new SoundManager();
