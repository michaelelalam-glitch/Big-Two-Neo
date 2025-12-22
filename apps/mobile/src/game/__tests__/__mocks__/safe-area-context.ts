/**
 * Mock for react-native-safe-area-context
 * Used in Jest tests to avoid module resolution issues
 */

import React from 'react';

export const SafeAreaView = ({ children, ...props }: any) => {
  return React.createElement('SafeAreaView', props, children);
};

export const SafeAreaProvider = ({ children, ...props }: any) => {
  return React.createElement('SafeAreaProvider', props, children);
};

export const useSafeAreaInsets = () => ({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

export const useSafeAreaFrame = () => ({
  x: 0,
  y: 0,
  width: 375,
  height: 812,
});

export const initialWindowMetrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};
