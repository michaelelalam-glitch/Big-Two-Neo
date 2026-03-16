/**
 * Mock for @livekit/react-native-webrtc
 *
 * Provides the subset of the API used by the iOS camera-permission fallback
 * path in useVideoChat.ts:
 *   - permissions.query({ name: 'camera' | 'microphone' }) → Promise<string>
 *   - mediaDevices.getUserMedia(constraints)              → Promise<MediaStream>
 *
 * Defaults return 'undetermined' / an empty stream so tests must explicitly
 * mock the response they expect via jest.spyOn / mockResolvedValueOnce.
 */

const mockStream = {
  getTracks: jest.fn((): { stop: () => void }[] => []),
};

export const permissions = {
  query: jest.fn((_constraint: { name: string }): Promise<string> =>
    Promise.resolve('undetermined')
  ),
};

export const mediaDevices = {
  getUserMedia: jest.fn(
    (_constraints: object): Promise<typeof mockStream> =>
      Promise.resolve({ ...mockStream, getTracks: jest.fn(() => []) })
  ),
};
