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

export const Dimensions = {
  get: jest.fn(() => ({ width: 375, height: 812 })),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
};

/**
 * Functional FlatList mock — renders header, all items, and footer so that
 * text-based assertions work in tests without requiring virtualization infra.
 */
export const FlatList = ({
  data,
  renderItem,
  keyExtractor,
  ListHeaderComponent,
  ListFooterComponent,
  style,
  contentContainerStyle,
  ...rest
}: any) => {
  const React = require('react');
  const header =
    ListHeaderComponent == null
      ? null
      : typeof ListHeaderComponent === 'function'
      ? React.createElement(ListHeaderComponent)
      : React.createElement('View', { testID: 'flatlist-header' }, ListHeaderComponent);

  const items = (data ?? []).map((item: any, index: number) => {
    const key = keyExtractor ? keyExtractor(item, index) : String(index);
    return renderItem ? React.createElement('View', { key }, renderItem({ item, index })) : null;
  });

  const footer =
    ListFooterComponent == null
      ? null
      : typeof ListFooterComponent === 'function'
      ? React.createElement(ListFooterComponent)
      : React.createElement('View', { testID: 'flatlist-footer' }, ListFooterComponent);

  return React.createElement('View', rest, header, ...items, footer);
};
