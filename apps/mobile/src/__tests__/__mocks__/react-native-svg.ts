/**
 * Jest mock for react-native-svg
 * Provides minimal stub components so tests importing InactivityCountdownRing
 * (via PlayerInfo → game/index) don't crash.
 *
 * Uses custom element names so snapshots clearly show the SVG structure.
 */
const React = require('react');

const createMock =
  (name: string) =>
  ({ children, ...props }: any) =>
    React.createElement(name, props, children);

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
