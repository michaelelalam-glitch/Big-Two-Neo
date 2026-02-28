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

const createMockAnimation = () => {
  const anim: any = {
    start: jest.fn((cb?: any) => { if (cb) cb({ finished: true }); }),
    stop: jest.fn(),
    reset: jest.fn(),
  };
  return anim;
};

export const Animated = {
  Value: jest.fn(() => ({
    setValue: jest.fn(),
    interpolate: jest.fn(() => ({ _value: 0 })),
    stopAnimation: jest.fn(),
    _value: 0,
  })),
  View: 'Animated.View',
  Text: 'Animated.Text',
  timing: jest.fn(() => createMockAnimation()),
  delay: jest.fn(() => createMockAnimation()),
  sequence: jest.fn(() => createMockAnimation()),
  parallel: jest.fn(() => createMockAnimation()),
  loop: jest.fn(() => createMockAnimation()),
  spring: jest.fn(() => createMockAnimation()),
  decay: jest.fn(() => createMockAnimation()),
  event: jest.fn(),
  createAnimatedComponent: jest.fn((component: any) => component),
};

// Mock useWindowDimensions hook
export const useWindowDimensions = jest.fn(() => ({
  width: 375,
  height: 812,
  scale: 2,
  fontScale: 1,
}));
