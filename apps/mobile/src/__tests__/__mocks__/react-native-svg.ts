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
};
