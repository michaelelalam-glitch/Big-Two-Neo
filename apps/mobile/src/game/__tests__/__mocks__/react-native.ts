// Mock for React Native module in Jest tests
export const Alert = {
  alert: jest.fn(),
};

export const Platform = {
  OS: 'ios',
  select: (obj: any) => obj.ios || obj.default,
};

export const StyleSheet = {
  create: (styles: any) => styles,
  flatten: (style: any) => style,
};

export const View = 'View';
export const Text = 'Text';
export const Pressable = 'Pressable';
export const ActivityIndicator = 'ActivityIndicator';
export const TouchableOpacity = 'TouchableOpacity';
export const ScrollView = 'ScrollView';
export const Modal = 'Modal';

export const Animated = {
  Value: jest.fn(() => ({
    setValue: jest.fn(),
  })),
  View: 'Animated.View',
  Text: 'Animated.Text',
  timing: jest.fn(() => ({
    start: jest.fn(),
  })),
  sequence: jest.fn((animations) => ({
    start: jest.fn(),
  })),
  loop: jest.fn((animation) => ({
    start: jest.fn(),
  })),
};

// Mock useWindowDimensions hook
export const useWindowDimensions = jest.fn(() => ({
  width: 375,
  height: 812,
  scale: 2,
  fontScale: 1,
}));
