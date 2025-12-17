/**
 * Image Preloading Utility
 * Preloads critical images for faster initial renders
 * Task #432: Image Optimization
 * Note: Using standard Image component (FastImage removed for Expo compatibility)
 */

import { Image } from 'react-native';
import { statsLogger } from './logger';

/**
 * Preload critical images on app startup
 * This reduces initial load time for frequently accessed screens
 */
export const preloadCriticalImages = async (): Promise<void> => {
  try {
    statsLogger.info('[ImagePreload] Starting critical image preload...');

    const imagesToPreload = [
      'https://developers.google.com/identity/images/g-logo.png',
      // Add more critical images here as needed
      // Example: Avatar placeholders, common icons, etc.
    ];

    // Preload using React Native Image.prefetch
    await Promise.all(
      imagesToPreload.map(uri => Image.prefetch(uri))
    );
    
    statsLogger.info(`[ImagePreload] Successfully preloaded ${imagesToPreload.length} images`);
  } catch (error) {
    statsLogger.error('[ImagePreload] Failed to preload images:', error);
  }
};

/**
 * Clear image cache (useful for debugging or when storage is low)
 */
export const clearImageCache = async (): Promise<void> => {
  try {
    // React Native doesn't expose cache clearing API
    // This is a no-op for compatibility
    statsLogger.info('[ImageCache] Cache clearing not available with standard Image component');
  } catch (error) {
    statsLogger.error('[ImageCache] Failed to clear cache:', error);
  }
};
