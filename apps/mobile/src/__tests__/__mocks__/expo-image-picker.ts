/**
 * Jest mock for expo-image-picker
 */

export const MediaTypeOptions = { Images: 'Images', Videos: 'Videos', All: 'All' };

export const requestMediaLibraryPermissionsAsync = jest
  .fn()
  .mockResolvedValue({ status: 'granted' });
export const requestCameraPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
export const launchImageLibraryAsync = jest.fn().mockResolvedValue({ canceled: true, assets: [] });
export const launchCameraAsync = jest.fn().mockResolvedValue({ canceled: true, assets: [] });
