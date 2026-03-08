/**
 * Jest mock for react-native-svg
 * Provides minimal stub components so tests importing InactivityCountdownRing
 * (via PlayerInfo → game/index) don't crash.
 */
const React = require('react');
const { View } = require('react-native');

const Svg = (props: any) => React.createElement(View, props);
const Circle = (props: any) => React.createElement(View, props);

module.exports = {
  __esModule: true,
  default: Svg,
  Svg,
  Circle,
};
