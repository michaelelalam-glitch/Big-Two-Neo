/**
 * Unit tests for useVideoChat — Task #651
 * Tests cover permission handling, opt-in/out flow, participant subscriptions,
 * and cleanup behaviour using the StubVideoChatAdapter.
 */

import { renderHook, act } from '@testing-library/react-native';
import { Platform, PermissionsAndroid } from 'react-native';
import {
  useVideoChat,
  StubVideoChatAdapter,
  VideoChatAdapter,
  VideoChatParticipant,
  CameraPermissionStatus,
} from '../useVideoChat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(overrides: Partial<VideoChatAdapter> = {}): VideoChatAdapter {
  const base = new StubVideoChatAdapter();
  // Spread of a class instance omits prototype methods; bind them explicitly.
  return {
    connect: base.connect.bind(base),
    disconnect: base.disconnect.bind(base),
    enableCamera: base.enableCamera.bind(base),
    disableCamera: base.disableCamera.bind(base),
    getParticipants: base.getParticipants.bind(base),
    onParticipantsChanged: base.onParticipantsChanged.bind(base),
    onError: base.onError.bind(base),
    ...overrides,
  };
}

const ROOM_ID = 'room-uuid-123';
const USER_ID = 'user-uuid-456';

// ---------------------------------------------------------------------------
// StubVideoChatAdapter — baseline
// ---------------------------------------------------------------------------

describe('StubVideoChatAdapter', () => {
  it('resolves all methods without throwing', async () => {
    const adapter = new StubVideoChatAdapter();
    await expect(adapter.connect(ROOM_ID, USER_ID)).resolves.toBeUndefined();
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    await expect(adapter.enableCamera()).resolves.toBeUndefined();
    await expect(adapter.disableCamera()).resolves.toBeUndefined();
    expect(adapter.getParticipants()).toEqual([]);
    const unsubP = adapter.onParticipantsChanged(() => {});
    expect(typeof unsubP).toBe('function');
    const unsubE = adapter.onError(() => {});
    expect(typeof unsubE).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('useVideoChat — initial state', () => {
  it('starts with video chat disabled', () => {
    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID })
    );
    expect(result.current.videoChatEnabled).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
    expect(result.current.cameraPermissionStatus).toBe('undetermined');
    expect(result.current.remoteParticipants).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toggleVideoChat — opt-in path
// ---------------------------------------------------------------------------

describe('useVideoChat — opt-in (toggleVideoChat enables camera)', () => {
  beforeEach(() => {
    // PermissionsAndroid.request is a native method — undefined in the Jest/Node
    // environment. Polyfill it as a jest.fn() so spyOn works correctly.
    if (typeof (PermissionsAndroid as any).request !== 'function') {
      (PermissionsAndroid as any).request = jest.fn();
    }
  });
  afterEach(() => { jest.restoreAllMocks(); });

  it('calls connect + enableCamera on first toggle (Android, permission granted)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.GRANTED
    );

    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const enableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy, enableCamera: enableCameraSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(connectSpy).toHaveBeenCalledWith(ROOM_ID, USER_ID);
    expect(enableCameraSpy).toHaveBeenCalledTimes(1);
    expect(result.current.videoChatEnabled).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(true);

    jest.restoreAllMocks();
  });

  it('does not enable camera when Android permission is denied', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.DENIED
    );

    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.current.videoChatEnabled).toBe(false);

    jest.restoreAllMocks();
  });

  it('does not enable camera when roomId is undefined', async () => {
    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: undefined, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.current.videoChatEnabled).toBe(false);
  });

  it('stays disabled and does not throw when connect() rejects', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const adapter = makeAdapter({
      connect: jest.fn().mockRejectedValue(new Error('Network error')),
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });

    // Non-fatal: video stays disabled, no thrown exception
    expect(result.current.videoChatEnabled).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toggleVideoChat — opt-out path
// ---------------------------------------------------------------------------

describe('useVideoChat — opt-out (toggleVideoChat disables camera)', () => {
  it('calls disableCamera + disconnect and resets state', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const disableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      disableCamera: disableCameraSpy,
      disconnect: disconnectSpy,
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // First: opt in
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.videoChatEnabled).toBe(true);

    // Then: opt out
    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(disableCameraSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(result.current.videoChatEnabled).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
    expect(result.current.remoteParticipants).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// remoteParticipants subscription
// ---------------------------------------------------------------------------

describe('useVideoChat — remoteParticipants', () => {
  it('updates remoteParticipants when the adapter fires onParticipantsChanged', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    let participantCb: ((p: VideoChatParticipant[]) => void) | null = null;
    const adapter = makeAdapter({
      onParticipantsChanged: (cb) => {
        participantCb = cb;
        return () => { participantCb = null; };
      },
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Opt in to activate the subscription
    await act(async () => {
      await result.current.toggleVideoChat();
    });

    const fakeParticipants: VideoChatParticipant[] = [
      { participantId: 'player-2', isCameraOn: true, isConnecting: false },
    ];

    act(() => {
      participantCb!(fakeParticipants);
    });

    expect(result.current.remoteParticipants).toEqual(fakeParticipants);
  });
});

// ---------------------------------------------------------------------------
// requestCameraPermission
// ---------------------------------------------------------------------------

describe('useVideoChat — requestCameraPermission', () => {
  it('returns "granted" on iOS (optimistic, until expo-camera is wired)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID })
    );

    let status: CameraPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    expect(status).toBe('granted');
    expect(result.current.cameraPermissionStatus).toBe('granted');
  });

  it('returns "restricted" when Android returns NEVER_ASK_AGAIN', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
    );

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID })
    );

    let status: CameraPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    expect(status).toBe('restricted');
    jest.restoreAllMocks();
  });
});
