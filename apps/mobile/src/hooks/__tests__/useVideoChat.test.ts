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
  MediaPermissionStatus,
} from '../useVideoChat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Save and restore Platform.OS around every test so overrides applied via
// Object.defineProperty do not leak across test files. Jest workers can run
// multiple suites in the same process, so an unrestore'd override persists
// and causes flaky failures in unrelated files. (#651)
let platformOSDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  platformOSDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
});
afterEach(() => {
  if (platformOSDescriptor) {
    Object.defineProperty(Platform, 'OS', platformOSDescriptor);
  }
});

function makeAdapter(overrides: Partial<VideoChatAdapter> = {}): VideoChatAdapter {
  const base = new StubVideoChatAdapter();
  // Spread of a class instance omits prototype methods; bind them explicitly.
  return {
    connect: base.connect.bind(base),
    disconnect: base.disconnect.bind(base),
    enableCamera: base.enableCamera.bind(base),
    disableCamera: base.disableCamera.bind(base),
    enableMicrophone: base.enableMicrophone.bind(base),
    disableMicrophone: base.disableMicrophone.bind(base),
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
    await expect(adapter.enableMicrophone()).resolves.toBeUndefined();
    await expect(adapter.disableMicrophone()).resolves.toBeUndefined();
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
    expect(result.current.isLocalMicOn).toBe(false);
    expect(result.current.cameraPermissionStatus).toBe('undetermined');
    expect(result.current.micPermissionStatus).toBe('undetermined');
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

  it('calls connect + enableCamera + enableMicrophone on first toggle (Android, both permissions granted)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    // First request = camera, second = microphone
    jest.spyOn(PermissionsAndroid, 'request')
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.GRANTED)
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.GRANTED);

    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const enableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const enableMicSpy = jest.fn().mockResolvedValue(undefined);
    const getParticipantsSpy = jest.fn().mockReturnValue([]);
    const adapter = makeAdapter({
      connect: connectSpy,
      enableCamera: enableCameraSpy,
      enableMicrophone: enableMicSpy,
      getParticipants: getParticipantsSpy,
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(connectSpy).toHaveBeenCalledWith(ROOM_ID, USER_ID);
    expect(enableCameraSpy).toHaveBeenCalledTimes(1);
    expect(enableMicSpy).toHaveBeenCalledTimes(1);
    // getParticipants() seeds remoteParticipants immediately on opt-in (#651)
    expect(getParticipantsSpy).toHaveBeenCalledTimes(1);
    expect(result.current.videoChatEnabled).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(true);
    expect(result.current.isLocalMicOn).toBe(true);
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
  });

  it('does not request mic permission when camera is denied (#651)', async () => {
    // Mic permission dialog must not appear if camera was denied — prompting
    // for mic when video chat will be blocked anyway is unnecessary and confusing.
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    // Clear accumulated mock call history before creating the spy so the
    // assertion is not polluted by calls from earlier tests in this suite.
    jest.clearAllMocks();
    const requestSpy = jest.spyOn(PermissionsAndroid, 'request')
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.DENIED); // camera only

    const adapter = makeAdapter();
    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });

    // CAMERA was requested (the gate check must have run).
    expect(requestSpy).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      expect.any(Object)
    );
    // RECORD_AUDIO must NOT have been requested — mic dialog is skipped when
    // camera is denied. (#651)
    expect(requestSpy).not.toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      expect.any(Object)
    );
    expect(result.current.videoChatEnabled).toBe(false);
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

  it('stays disabled and calls best-effort cleanup when connect() rejects (#651)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const disableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const disableMicSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      connect: jest.fn().mockRejectedValue(new Error('Network error')),
      disconnect: disconnectSpy,
      disableCamera: disableCameraSpy,
      disableMicrophone: disableMicSpy,
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
    expect(result.current.isLocalMicOn).toBe(false);
    // Cleanup methods called to prevent lingering half-connected state
    expect(disableCameraSpy).toHaveBeenCalledTimes(1);
    expect(disableMicSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// toggleVideoChat — opt-out path
// ---------------------------------------------------------------------------

describe('useVideoChat — opt-out (toggleVideoChat disables camera + mic)', () => {
  it('calls disableMicrophone + disableCamera + disconnect and resets state', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const disableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const disableMicSpy = jest.fn().mockResolvedValue(undefined);
    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      disableCamera: disableCameraSpy,
      disableMicrophone: disableMicSpy,
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

    expect(disableMicSpy).toHaveBeenCalledTimes(1);
    expect(disableCameraSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(result.current.videoChatEnabled).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
    expect(result.current.isLocalMicOn).toBe(false);
    expect(result.current.remoteParticipants).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// roomId change — state reset (#651)
// ---------------------------------------------------------------------------

describe('useVideoChat — roomId change resets state', () => {
  it('disables camera + resets state when roomId changes while video is active (#651)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const disableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const disableMicSpy = jest.fn().mockResolvedValue(undefined);
    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      disableCamera: disableCameraSpy,
      disableMicrophone: disableMicSpy,
      disconnect: disconnectSpy,
    });

    const { result, rerender } = renderHook(
      ({ roomId }: { roomId: string }) =>
        useVideoChat({ roomId, userId: USER_ID, adapter }),
      { initialProps: { roomId: ROOM_ID } }
    );

    // Opt in
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.videoChatEnabled).toBe(true);

    // Change roomId — simulates navigating to a different game room
    await act(async () => {
      rerender({ roomId: 'room-uuid-NEW' });
    });

    // Teardown must have fired
    expect(disableMicSpy).toHaveBeenCalledTimes(1);
    expect(disableCameraSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    // UI state must be reset (not left showing "enabled" for the new room)
    expect(result.current.videoChatEnabled).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
    expect(result.current.isLocalMicOn).toBe(false);
    expect(result.current.remoteParticipants).toEqual([]);
  });

  it('does not disconnect on initial mount when roomId is first provided (#651)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ disconnect: disconnectSpy });

    renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // disconnect must NOT be called on first render — prevRoomIdRef starts undefined
    expect(disconnectSpy).not.toHaveBeenCalled();
  });

  it('does not disconnect when roomId changes but video chat is not enabled (#651)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const disableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const disableMicSpy = jest.fn().mockResolvedValue(undefined);
    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      disableCamera: disableCameraSpy,
      disableMicrophone: disableMicSpy,
      disconnect: disconnectSpy,
    });

    const { rerender } = renderHook(
      ({ roomId }: { roomId: string }) =>
        useVideoChat({ roomId, userId: USER_ID, adapter }),
      { initialProps: { roomId: ROOM_ID } }
    );

    // Video chat was never enabled — the hook is in the default off state
    // Changing roomId should NOT trigger any adapter teardown because there
    // is no active session to tear down. (#651)
    await act(async () => {
      rerender({ roomId: 'room-uuid-NEW' });
    });

    expect(disableMicSpy).not.toHaveBeenCalled();
    expect(disableCameraSpy).not.toHaveBeenCalled();
    expect(disconnectSpy).not.toHaveBeenCalled();
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
      { participantId: 'player-2', isCameraOn: true, isMicOn: true, isConnecting: false },
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

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    // Returns 'granted' so stub-mode operation proceeds, but intentionally does
    // NOT persist to state — state stays 'undetermined' until the real SDK
    // (expo-camera) is installed and can query the actual OS decision. (#651)
    expect(status).toBe('granted');
    expect(result.current.cameraPermissionStatus).toBe('undetermined');
  });

  it('returns "restricted" when Android returns NEVER_ASK_AGAIN', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
    );

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID })
    );

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    expect(status).toBe('restricted');
  });

  it('returns "restricted" on web / unsupported platforms (#651)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'web' });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID })
    );

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    // Web is not a supported video-chat platform; opt-in must be blocked.
    expect(status).toBe('restricted');
    // State should remain undetermined (nothing to persist)
    expect(result.current.cameraPermissionStatus).toBe('undetermined');
  });
});

// ---------------------------------------------------------------------------
// requestMicPermission
// ---------------------------------------------------------------------------

describe('useVideoChat — requestMicPermission', () => {
  it('returns "granted" on iOS (optimistic, until real SDK is wired)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID })
    );

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestMicPermission();
    });

    // Returns 'granted' so stub-mode operation proceeds, but intentionally does
    // NOT persist to state — state stays 'undetermined' until the real SDK
    // can query the actual OS microphone decision. (#651)
    expect(status).toBe('granted');
    expect(result.current.micPermissionStatus).toBe('undetermined');
  });

  it('returns "denied" when Android mic permission is denied', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    if (typeof (PermissionsAndroid as any).request !== 'function') {
      (PermissionsAndroid as any).request = jest.fn();
    }
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValueOnce(
      PermissionsAndroid.RESULTS.DENIED
    );

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID })
    );

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestMicPermission();
    });

    expect(status).toBe('denied');
    expect(result.current.micPermissionStatus).toBe('denied');
  });

  it('returns "restricted" on web / unsupported platforms (#651)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'web' });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID })
    );

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestMicPermission();
    });

    expect(status).toBe('restricted');
    expect(result.current.micPermissionStatus).toBe('undetermined');
  });
});

// ---------------------------------------------------------------------------
// toggleMic
// ---------------------------------------------------------------------------

describe('useVideoChat — toggleMic', () => {
  it('does nothing when video chat is not enabled', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const enableMicSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ enableMicrophone: enableMicSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleMic();
    });

    expect(enableMicSpy).not.toHaveBeenCalled();
    expect(result.current.isLocalMicOn).toBe(false);
  });

  it('mutes mic when video chat is active and mic is on', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const disableMicSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ disableMicrophone: disableMicSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Opt in (enables both camera + mic on iOS with optimistic permission)
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.isLocalMicOn).toBe(true);

    // Mute
    await act(async () => {
      await result.current.toggleMic();
    });

    expect(disableMicSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isLocalMicOn).toBe(false);
  });

  it('unmutes mic when video chat is active and mic is muted', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const enableMicSpy = jest.fn().mockResolvedValue(undefined);
    const disableMicSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      enableMicrophone: enableMicSpy,
      disableMicrophone: disableMicSpy,
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Opt in
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.isLocalMicOn).toBe(true);

    // Mute
    await act(async () => {
      await result.current.toggleMic();
    });
    expect(result.current.isLocalMicOn).toBe(false);

    // Unmute (toggleMic when micPermissionStatus is already 'granted')
    await act(async () => {
      await result.current.toggleMic();
    });
    expect(result.current.isLocalMicOn).toBe(true);
    // enableMic called once on opt-in + once on unmute
    expect(enableMicSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// toggleVideoChat — opt-out even when roomId becomes undefined (#651)
// ---------------------------------------------------------------------------

describe('useVideoChat — opt-out allows teardown when roomId becomes undefined (#651)', () => {
  it('can opt out and reset state even when roomId is transiently undefined', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const disableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const disableMicSpy = jest.fn().mockResolvedValue(undefined);
    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      disableCamera: disableCameraSpy,
      disableMicrophone: disableMicSpy,
      disconnect: disconnectSpy,
    });

    const { result, rerender } = renderHook(
      ({ roomId }: { roomId: string | undefined }) =>
        useVideoChat({ roomId, userId: USER_ID, adapter }),
      { initialProps: { roomId: ROOM_ID as string | undefined } }
    );

    // Opt in with a valid roomId
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.videoChatEnabled).toBe(true);

    // roomId transiently disappears (e.g. partial re-render during navigation)
    rerender({ roomId: undefined });

    // Opt out must still work — the guard is in opt-in only
    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(disableMicSpy).toHaveBeenCalledTimes(1);
    expect(disableCameraSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(result.current.videoChatEnabled).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
  });

  it('still blocks opt-in when roomId is undefined', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
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
});

// ---------------------------------------------------------------------------
// enableMicrophone failure is non-blocking — camera stays active (#651)
// ---------------------------------------------------------------------------

describe('useVideoChat — mic enable failure does not tear down camera (#651)', () => {
  it('leaves camera active when enableMicrophone throws', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const enableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const enableMicSpy = jest.fn().mockRejectedValue(new Error('Mic hardware error'));
    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const disableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const disableMicSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      enableCamera: enableCameraSpy,
      enableMicrophone: enableMicSpy,
      disconnect: disconnectSpy,
      disableCamera: disableCameraSpy,
      disableMicrophone: disableMicSpy,
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });

    // Camera must be on — mic failure is non-blocking
    expect(result.current.videoChatEnabled).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(true);
    // Mic is off (it threw)
    expect(result.current.isLocalMicOn).toBe(false);
    // The outer catch path must NOT have fired — disableCamera/disconnect not called
    expect(disableCameraSpy).not.toHaveBeenCalled();
    expect(disconnectSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// adapterRef synchronised during render — swap teardown via prevAdapterPropRef
// adapterProp synced during render / adapter hot-swap (#651)
// ---------------------------------------------------------------------------

describe('useVideoChat — adapterProp synced during render (#651)', () => {
  it('tears down the old adapter when adapterProp is swapped while connected', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    // Adapter A — used for the initial connection
    const disableCameraA = jest.fn().mockResolvedValue(undefined);
    const disableMicA = jest.fn().mockResolvedValue(undefined);
    const disconnectA = jest.fn().mockResolvedValue(undefined);
    const adapterA = makeAdapter({ disableCamera: disableCameraA, disableMicrophone: disableMicA, disconnect: disconnectA });

    const { result, rerender } = renderHook(
      ({ adapter }: { adapter: typeof adapterA }) =>
        useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter }),
      { initialProps: { adapter: adapterA } }
    );

    // Enable video with adapterA
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.videoChatEnabled).toBe(true);

    // Adapter B — injected while connected
    const adapterB = makeAdapter();

    // Swap the adapter — effect should run teardown on adapterA
    await act(async () => {
      rerender({ adapter: adapterB });
    });

    expect(disableCameraA).toHaveBeenCalledTimes(1);
    expect(disableMicA).toHaveBeenCalledTimes(1);
    expect(disconnectA).toHaveBeenCalledTimes(1);
    // State reset to disabled after swap
    expect(result.current.videoChatEnabled).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
  });

  it('does not tear down adapter on videoChatEnabled change when adapter is unchanged', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const disableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ disableCamera: disableCameraSpy, disconnect: disconnectSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Enable then opt-out — uses the opt-out path, not the swap-teardown effect
    await act(async () => {
      await result.current.toggleVideoChat(); // enable
    });
    await act(async () => {
      await result.current.toggleVideoChat(); // opt-out
    });

    // disableCamera called once by the explicit opt-out path (not twice)
    expect(disableCameraSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it('tears down old adapter when adapterProp changes to undefined while connected (#651)', async () => {
    // r2936183676 — the !adapterProp guard was removed so that real→undefined
    // also triggers best-effort cleanup, not just A→B swaps.
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const disableCameraA = jest.fn().mockResolvedValue(undefined);
    const disableMicA = jest.fn().mockResolvedValue(undefined);
    const disconnectA = jest.fn().mockResolvedValue(undefined);
    const adapterA = makeAdapter({ disableCamera: disableCameraA, disableMicrophone: disableMicA, disconnect: disconnectA });

    const { result, rerender } = renderHook(
      ({ adapter }: { adapter: typeof adapterA | undefined }) =>
        useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter }),
      { initialProps: { adapter: adapterA as typeof adapterA | undefined } }
    );

    // Enable video with adapterA
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.videoChatEnabled).toBe(true);

    // Remove the injected adapter (real → undefined) — teardown must still fire
    await act(async () => {
      rerender({ adapter: undefined });
    });

    expect(disableCameraA).toHaveBeenCalledTimes(1);
    expect(disableMicA).toHaveBeenCalledTimes(1);
    expect(disconnectA).toHaveBeenCalledTimes(1);
    // State reset to disabled after removal
    expect(result.current.videoChatEnabled).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toggleVideoChat re-entrant guard — isConnecting state (#651)
// ---------------------------------------------------------------------------

describe('useVideoChat — toggleVideoChat re-entrant guard (#651)', () => {
  it('isConnecting starts false and is false after a complete toggle', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID })
    );

    expect(result.current.isConnecting).toBe(false);

    // Opt in
    await act(async () => {
      await result.current.toggleVideoChat();
    });

    // After the toggle resolves, isConnecting must return to false
    expect(result.current.isConnecting).toBe(false);
    expect(result.current.videoChatEnabled).toBe(true);
  });

  it('second toggleVideoChat call is ignored while first is in-flight (#651)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    let resolveConnect!: () => void;
    const connectSpy = jest.fn().mockReturnValue(
      new Promise<void>((resolve) => { resolveConnect = resolve; })
    );
    const enableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy, enableCamera: enableCameraSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Fire the first toggle without awaiting — leave it in-flight on connect()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    result.current.toggleVideoChat();

    // Fire the second toggle; isTogglingRef is already true so it returns early
    await act(async () => {
      await result.current.toggleVideoChat();
    });

    // Resolve connect() to let the first toggle complete
    await act(async () => {
      resolveConnect();
    });

    // connect() must only have been called once — the second call was short-circuited
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(enableCameraSpy).toHaveBeenCalledTimes(1);

    // isConnecting should be false once the first toggle finishes
    expect(result.current.isConnecting).toBe(false);
  });
});
