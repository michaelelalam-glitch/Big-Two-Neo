const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Removed WebRTC mock aliasing to allow real WebRTC in development builds
// The mock was only needed for Expo Go, but we're building a custom dev client
// that includes the native react-native-webrtc module

module.exports = config;
