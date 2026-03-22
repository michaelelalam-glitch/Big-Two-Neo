/**
 * Jest mock for react-native-svg
 * Provides minimal stub components so tests importing InactivityCountdownRing
 * (via PlayerInfo → game/index) don't crash.
 *
 * Uses React Native's <View> as the host element (with a testID naming the SVG
 * component) so snapshots remain readable and the test renderer never
 * encounters unknown host component strings that throw in RN environments.
 */
const React = require('react');
const { View } = require('react-native');

// Each mock renders as a known <View> host component.
// testID is set to the SVG element name so snapshot output is still readable.
const createMock =
  (name: string) =>
  ({ children, testID, ...props }: any) =>
    React.createElement(View, { ...props, testID: testID ?? name }, children);

module.exports = {
  __esModule: true,
  default: createMock('Svg'),
  Svg: createMock('Svg'),
  Circle: createMock('Circle'),
  Path: createMock('Path'),
  G: createMock('G'),
  Line: createMock('Line'),
  Polyline: createMock('Polyline'),
  Rect: createMock('Rect'),
  Ellipse: createMock('Ellipse'),
  Polygon: createMock('Polygon'),
  Text: createMock('Text'),
  TSpan: createMock('TSpan'),
  Defs: createMock('Defs'),
  Stop: createMock('Stop'),
  LinearGradient: createMock('LinearGradient'),
  RadialGradient: createMock('RadialGradient'),
  ClipPath: createMock('ClipPath'),
  Mask: createMock('Mask'),
  Use: createMock('Use'),
  Image: createMock('Image'),
};
