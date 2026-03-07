/**
 * Jest mock for expo-file-system
 *
 * expo-file-system uses ESM `export *` syntax which is incompatible with Jest's
 * CJS `require()`. The real module is only needed for the optional file-logging
 * transport in logger.ts (it gracefully degrades to console when absent).
 * This mock provides a minimal stub so Jest can load the module without errors.
 */

export const documentDirectory = null;
export const cacheDirectory = null;
export const bundleDirectory = null;

export const getInfoAsync = jest.fn().mockResolvedValue({ exists: false, isDirectory: false, size: 0, modificationTime: 0, uri: '' });
export const readAsStringAsync = jest.fn().mockResolvedValue('');
export const writeAsStringAsync = jest.fn().mockResolvedValue(undefined);
export const deleteAsync = jest.fn().mockResolvedValue(undefined);
export const makeDirectoryAsync = jest.fn().mockResolvedValue(undefined);
export const copyAsync = jest.fn().mockResolvedValue(undefined);
export const moveAsync = jest.fn().mockResolvedValue(undefined);
export const readDirectoryAsync = jest.fn().mockResolvedValue([]);
export const downloadAsync = jest.fn().mockResolvedValue({ uri: '', status: 200, headers: {}, md5: undefined });

export default {
  documentDirectory,
  cacheDirectory,
  bundleDirectory,
  getInfoAsync,
  readAsStringAsync,
  writeAsStringAsync,
  deleteAsync,
  makeDirectoryAsync,
  copyAsync,
  moveAsync,
  readDirectoryAsync,
  downloadAsync,
};
