/**
 * Mock for expo-clipboard
 * Prevents native-module resolution errors in Jest (node / non-native) environments.
 */

export const setStringAsync = jest.fn(() => Promise.resolve(undefined));
export const getStringAsync = jest.fn(() => Promise.resolve(''));
export const hasStringAsync = jest.fn(() => Promise.resolve(false));
export const setString = jest.fn();
export const getString = jest.fn(() => '');
