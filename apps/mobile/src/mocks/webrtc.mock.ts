/**
 * WebRTC Mock for Expo Go
 * This allows the app to load in Expo Go without native modules
 * For actual WebRTC functionality, use a development build
 */

// Mock MediaStream
export class MediaStream {
  id: string = 'mock-stream';
  active: boolean = false;
  
  getTracks() {
    return [];
  }
  
  getAudioTracks() {
    return [];
  }
  
  getVideoTracks() {
    return [];
  }
  
  addTrack() {}
  removeTrack() {}
  clone() {
    return new MediaStream();
  }
}

// Mock RTCView component
export const RTCView = ({ style }: any) => {
  const React = require('react');
  const { View, Text } = require('react-native');
  
  return React.createElement(
    View,
    { style: [style, { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' }] },
    React.createElement(Text, { style: { color: '#666', fontSize: 12 } }, 'Video Preview')
  );
};

// Mock other WebRTC exports
export const RTCPeerConnection = class {
  constructor() {}
  createOffer() { return Promise.resolve({}); }
  createAnswer() { return Promise.resolve({}); }
  setLocalDescription() { return Promise.resolve(); }
  setRemoteDescription() { return Promise.resolve(); }
  addIceCandidate() { return Promise.resolve(); }
  close() {}
};

export const RTCIceCandidate = class {
  constructor(init: any) {}
};

export const RTCSessionDescription = class {
  constructor(init: any) {}
};

export const mediaDevices = {
  getUserMedia: () => Promise.resolve(new MediaStream()),
  enumerateDevices: () => Promise.resolve([]),
};

export default {
  RTCView,
  MediaStream,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
};
