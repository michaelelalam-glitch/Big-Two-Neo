/**
 * Unit tests for useVideoChat — Task #651
 * Tests cover permission handling, opt-in/out flow, participant subscriptions,
 * and cleanup behaviour using the StubVideoChatAdapter.
 */

import { renderHook, act } from '@testing-library/react-native';
import { Platform, PermissionsAndroid } from 'react-native';
// AsyncStorage is auto-mocked via jest.config.js moduleNameMapper →
// src/game/__tests__/__mocks__/async-storage.ts (all methods are jest.fn()).
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useVideoChat,
  StubVideoChatAdapter,
  VideoChatAdapter,
  VideoChatParticipant,
  MediaPermissionStatus,
  UnexpectedDisconnectError,
} from '../useVideoChat';
import { i18n } from '../../i18n';

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
    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));
    expect(result.current.isChatConnected).toBe(false);
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
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls connect + enableCamera + enableMicrophone on first toggle (Android, both permissions granted)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    // First request = camera, second = microphone
    jest
      .spyOn(PermissionsAndroid, 'request')
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
    expect(result.current.isChatConnected).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(true);
    expect(result.current.isLocalMicOn).toBe(true);
  });

  it('does not enable camera when Android permission is denied', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.DENIED);

    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.current.isChatConnected).toBe(false);
  });

  it('does not request mic permission when camera is denied (#651)', async () => {
    // Mic permission dialog must not appear if camera was denied — prompting
    // for mic when video chat will be blocked anyway is unnecessary and confusing.
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    // Clear accumulated mock call history before creating the spy so the
    // assertion is not polluted by calls from earlier tests in this suite.
    jest.clearAllMocks();
    const requestSpy = jest
      .spyOn(PermissionsAndroid, 'request')
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
    expect(result.current.isChatConnected).toBe(false);
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
    expect(result.current.isChatConnected).toBe(false);
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
    expect(result.current.isChatConnected).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
    expect(result.current.isLocalMicOn).toBe(false);
    // Cleanup methods called to prevent lingering half-connected state
    expect(disableCameraSpy).toHaveBeenCalledTimes(1);
    expect(disableMicSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it('shows Alert when connect() rejects during toggleVideoChat (#651)', async () => {
    // Clear accumulated mock call history before creating the spy so the
    // assertion is not polluted by calls from earlier tests in this suite.
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.GRANTED) // camera
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.GRANTED); // mic
    const { Alert } = require('react-native') as typeof import('react-native');
    jest.spyOn(Alert, 'alert');

    const adapter = makeAdapter({
      connect: jest.fn().mockRejectedValue(new Error('Network error')),
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });

    // User must be informed — Alert shown with the connect-failed i18n key
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe(i18n.t('chat.connectFailedTitle'));
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
    expect(result.current.isChatConnected).toBe(true);

    // Then: opt out
    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(disableMicSpy).toHaveBeenCalledTimes(1);
    expect(disableCameraSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isChatConnected).toBe(false);
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
      ({ roomId }: { roomId: string }) => useVideoChat({ roomId, userId: USER_ID, adapter }),
      { initialProps: { roomId: ROOM_ID } }
    );

    // Opt in
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.isChatConnected).toBe(true);

    // Change roomId — simulates navigating to a different game room
    await act(async () => {
      rerender({ roomId: 'room-uuid-NEW' });
    });

    // Teardown must have fired
    expect(disableMicSpy).toHaveBeenCalledTimes(1);
    expect(disableCameraSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    // UI state must be reset (not left showing "enabled" for the new room)
    expect(result.current.isChatConnected).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
    expect(result.current.isLocalMicOn).toBe(false);
    expect(result.current.remoteParticipants).toEqual([]);
  });

  it('does not disconnect on initial mount when roomId is first provided (#651)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ disconnect: disconnectSpy });

    renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter }));

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
      ({ roomId }: { roomId: string }) => useVideoChat({ roomId, userId: USER_ID, adapter }),
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
      onParticipantsChanged: cb => {
        participantCb = cb;
        return () => {
          participantCb = null;
        };
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
  it('returns "granted" and persists state when camera is already granted (iOS, default mock)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    // Real implementation: getCameraPermissionsAsync returns 'granted' (mock default),
    // status is returned AND persisted to cameraPermissionStatus state.
    expect(status).toBe('granted');
    expect(result.current.cameraPermissionStatus).toBe('granted');
  });

  it('returns "restricted" when Android returns NEVER_ASK_AGAIN', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    expect(status).toBe('restricted');
  });

  it('returns "restricted" on web / unsupported platforms (#651)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'web' });

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

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
  it('returns "granted" and persists state when mic is already granted (iOS, default mock)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestMicPermission();
    });

    // Real implementation: getPermissionsAsync returns 'granted' (mock default),
    // status is returned AND persisted to micPermissionStatus state.
    expect(status).toBe('granted');
    expect(result.current.micPermissionStatus).toBe('granted');
  });

  it('returns "denied" when Android mic permission is denied', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    if (typeof (PermissionsAndroid as any).request !== 'function') {
      (PermissionsAndroid as any).request = jest.fn();
    }
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.DENIED);

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestMicPermission();
    });

    expect(status).toBe('denied');
    expect(result.current.micPermissionStatus).toBe('denied');
  });

  it('returns "restricted" on web / unsupported platforms (#651)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'web' });

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

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
    expect(result.current.isChatConnected).toBe(true);

    // roomId transiently disappears (e.g. partial re-render during navigation)
    rerender({ roomId: undefined });

    // Opt out must still work — the guard is in opt-in only
    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(disableMicSpy).toHaveBeenCalledTimes(1);
    expect(disableCameraSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isChatConnected).toBe(false);
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
    expect(result.current.isChatConnected).toBe(false);
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
    expect(result.current.isChatConnected).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(true);
    // Mic is off (it threw)
    expect(result.current.isLocalMicOn).toBe(false);
    // The outer catch path must NOT have fired — disableCamera/disconnect not called
    expect(disableCameraSpy).not.toHaveBeenCalled();
    expect(disconnectSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UnexpectedDisconnectError — fatal reset path (#651)
// ---------------------------------------------------------------------------

describe('useVideoChat — UnexpectedDisconnectError resets session state', () => {
  it('resets isChatConnected, camera, mic, and remoteParticipants on unexpected disconnect', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    let errorCb: ((err: Error) => void) | null = null;
    const adapter = makeAdapter({
      onError: cb => {
        errorCb = cb;
        return () => {
          errorCb = null;
        };
      },
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Opt in — establishes the connected state and activates the onError subscription
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.isChatConnected).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(true);
    expect(result.current.isLocalMicOn).toBe(true);

    // Simulate the adapter firing an UnexpectedDisconnectError (surprise network drop)
    act(() => {
      errorCb!(new UnexpectedDisconnectError('server closed connection'));
    });

    expect(result.current.isChatConnected).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
    expect(result.current.isLocalMicOn).toBe(false);
    expect(result.current.remoteParticipants).toEqual([]);
  });

  it('does not reset state for non-fatal adapter errors', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    let errorCb: ((err: Error) => void) | null = null;
    const adapter = makeAdapter({
      onError: cb => {
        errorCb = cb;
        return () => {
          errorCb = null;
        };
      },
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.isChatConnected).toBe(true);

    // Fire a generic (non-fatal) error — session must remain intact
    act(() => {
      errorCb!(new Error('transient jitter'));
    });

    expect(result.current.isChatConnected).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(true);
    expect(result.current.isLocalMicOn).toBe(true);
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
    const adapterA = makeAdapter({
      disableCamera: disableCameraA,
      disableMicrophone: disableMicA,
      disconnect: disconnectA,
    });

    const { result, rerender } = renderHook(
      ({ adapter }: { adapter: typeof adapterA }) =>
        useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter }),
      { initialProps: { adapter: adapterA } }
    );

    // Enable video with adapterA
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.isChatConnected).toBe(true);

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
    expect(result.current.isChatConnected).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
  });

  it('does not tear down adapter on isChatConnected change when adapter is unchanged', async () => {
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
    const adapterA = makeAdapter({
      disableCamera: disableCameraA,
      disableMicrophone: disableMicA,
      disconnect: disconnectA,
    });

    const { result, rerender } = renderHook(
      ({ adapter }: { adapter: typeof adapterA | undefined }) =>
        useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter }),
      { initialProps: { adapter: adapterA as typeof adapterA | undefined } }
    );

    // Enable video with adapterA
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.isChatConnected).toBe(true);

    // Remove the injected adapter (real → undefined) — teardown must still fire
    await act(async () => {
      rerender({ adapter: undefined });
    });

    expect(disableCameraA).toHaveBeenCalledTimes(1);
    expect(disableMicA).toHaveBeenCalledTimes(1);
    expect(disconnectA).toHaveBeenCalledTimes(1);
    // State reset to disabled after removal
    expect(result.current.isChatConnected).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toggleVideoChat re-entrant guard — isConnecting state (#651)
// ---------------------------------------------------------------------------

describe('useVideoChat — toggleVideoChat re-entrant guard (#651)', () => {
  it('isConnecting starts false and is false after a complete toggle', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    expect(result.current.isConnecting).toBe(false);

    // Opt in
    await act(async () => {
      await result.current.toggleVideoChat();
    });

    // After the toggle resolves, isConnecting must return to false
    expect(result.current.isConnecting).toBe(false);
    expect(result.current.isChatConnected).toBe(true);
  });

  it('second toggleVideoChat call is ignored while first is in-flight (#651)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

    let resolveConnect!: () => void;
    const connectSpy = jest.fn().mockReturnValue(
      new Promise<void>(resolve => {
        resolveConnect = resolve;
      })
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

// ---------------------------------------------------------------------------
// toggleVoiceChat — voice-only join/leave (#651)
// ---------------------------------------------------------------------------

describe('useVideoChat — toggleVoiceChat (voice-only join/leave)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('connects mic-only when not connected (iOS — permission auto-granted)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const enableMicSpy = jest.fn().mockResolvedValue(undefined);
    const enableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      connect: connectSpy,
      enableMicrophone: enableMicSpy,
      enableCamera: enableCameraSpy,
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVoiceChat();
    });

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(enableMicSpy).toHaveBeenCalledTimes(1);
    // Camera must NOT be enabled in voice-only mode
    expect(enableCameraSpy).not.toHaveBeenCalled();
    expect(result.current.isChatConnected).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(false);
    expect(result.current.isLocalMicOn).toBe(true);
    expect(result.current.voiceChatEnabled).toBe(true);
  });

  it('disconnects when called while voice-only is active', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const disableMicSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ disconnect: disconnectSpy, disableMicrophone: disableMicSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // First — opt in to voice-only
    await act(async () => {
      await result.current.toggleVoiceChat();
    });
    expect(result.current.isChatConnected).toBe(true);

    // Second — opt out
    await act(async () => {
      await result.current.toggleVoiceChat();
    });

    expect(disableMicSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isChatConnected).toBe(false);
    expect(result.current.isLocalMicOn).toBe(false);
    expect(result.current.voiceChatEnabled).toBe(false);
  });

  it('is a no-op when video chat (camera on) is already active', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const enableMicSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy, enableMicrophone: enableMicSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Opt in to full video chat first
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.isChatConnected).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(true);

    const callsBeforeVoiceToggle = connectSpy.mock.calls.length;

    // toggleVoiceChat must be a no-op — camera is on
    await act(async () => {
      await result.current.toggleVoiceChat();
    });

    // No additional connections should be made
    expect(connectSpy.mock.calls.length).toBe(callsBeforeVoiceToggle);
    // State must remain unchanged
    expect(result.current.isChatConnected).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(true);
  });

  it('requests microphone permission on Android before connecting', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    (PermissionsAndroid.request as jest.Mock) = jest
      .fn()
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const enableMicSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy, enableMicrophone: enableMicSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVoiceChat();
    });

    expect(PermissionsAndroid.request).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      expect.any(Object)
    );
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(enableMicSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isChatConnected).toBe(true);
  });

  it('blocks voice chat when microphone permission is denied', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    (PermissionsAndroid.request as jest.Mock) = jest
      .fn()
      .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVoiceChat();
    });

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.current.isChatConnected).toBe(false);
  });

  it('stays disabled and shows Alert when connect() rejects during toggleVoiceChat (#651)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    (PermissionsAndroid.request as jest.Mock) = jest
      .fn()
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    const { Alert } = require('react-native') as typeof import('react-native');
    jest.clearAllMocks(); // isolate from any residual spies in this describe
    jest.spyOn(Alert, 'alert');

    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const disableMicSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      connect: jest.fn().mockRejectedValue(new Error('Server error')),
      disconnect: disconnectSpy,
      disableMicrophone: disableMicSpy,
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVoiceChat();
    });

    // Non-fatal: voice stays disabled
    expect(result.current.isChatConnected).toBe(false);
    expect(result.current.isLocalMicOn).toBe(false);
    // Cleanup called
    expect(disableMicSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    // User must be informed — Alert shown with the connect-failed i18n key
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe(i18n.t('chat.voiceConnectFailedTitle'));
  });
});

// ---------------------------------------------------------------------------
// toggleCamera — camera track on/off within an active session (#651)
// ---------------------------------------------------------------------------

describe('useVideoChat — toggleCamera (camera track toggle within session)', () => {
  it('enables camera when connected and camera is off', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const enableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ enableCamera: enableCameraSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Connect via voice-only first (camera off, mic on)
    await act(async () => {
      await result.current.toggleVoiceChat();
    });
    expect(result.current.isChatConnected).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(false);

    // Upgrade camera within the session
    await act(async () => {
      await result.current.toggleCamera();
    });

    // toggleVoiceChat (voice-only) never enables the camera,
    // so enableCamera is called exactly once — by the toggleCamera() call above.
    expect(enableCameraSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isLocalCameraOn).toBe(true);
    // Session must remain active
    expect(result.current.isChatConnected).toBe(true);
  });

  it('disables camera when connected and camera is on', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const disableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ disableCamera: disableCameraSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Connect with full video
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.isLocalCameraOn).toBe(true);

    // Turn camera off within the session
    await act(async () => {
      await result.current.toggleCamera();
    });

    expect(disableCameraSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isLocalCameraOn).toBe(false);
    // Session must remain active — only camera track is off
    expect(result.current.isChatConnected).toBe(true);
    // voiceChatEnabled derived flag reflects camera-down state
    expect(result.current.voiceChatEnabled).toBe(true);
  });

  it('is a no-op when not connected', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const enableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const disableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ enableCamera: enableCameraSpy, disableCamera: disableCameraSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleCamera();
    });

    expect(enableCameraSpy).not.toHaveBeenCalled();
    expect(disableCameraSpy).not.toHaveBeenCalled();
    expect(result.current.isLocalCameraOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toggleVideoChat — voice-only → video upgrade path (#651)
// ---------------------------------------------------------------------------

describe('useVideoChat — toggleVideoChat voice-only → video upgrade', () => {
  it('enables camera (without disconnecting) when called while voice-only is active', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const enableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      connect: connectSpy,
      disconnect: disconnectSpy,
      enableCamera: enableCameraSpy,
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Join voice-only first
    await act(async () => {
      await result.current.toggleVoiceChat();
    });
    expect(result.current.isChatConnected).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(false);

    // Pressing "join video chat" while voice-only should upgrade, not disconnect
    await act(async () => {
      await result.current.toggleVideoChat();
    });

    // Session must NOT have been disconnected/reconnected
    expect(disconnectSpy).not.toHaveBeenCalled();
    // connect should only have been called once (for the initial voice join)
    expect(connectSpy).toHaveBeenCalledTimes(1);
    // Camera should now be enabled
    expect(enableCameraSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isLocalCameraOn).toBe(true);
    expect(result.current.isChatConnected).toBe(true);
    expect(result.current.voiceChatEnabled).toBe(false);
  });

  it('disconnects full session when called while camera is on', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const disconnectSpy = jest.fn().mockResolvedValue(undefined);
    const disableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const disableMicSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      disconnect: disconnectSpy,
      disableCamera: disableCameraSpy,
      disableMicrophone: disableMicSpy,
    });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Join with full video
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    expect(result.current.isLocalCameraOn).toBe(true);

    // Opt out — should fully disconnect
    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(disableCameraSpy).toHaveBeenCalledTimes(1);
    expect(disableMicSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isChatConnected).toBe(false);
    expect(result.current.isLocalCameraOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — iOS permission UX (Camera.requestCameraPermissionsAsync + expo-audio permission APIs)
// ---------------------------------------------------------------------------

describe('useVideoChat — Phase 4 iOS permission UX', () => {
  // Lazily import the mocks so Jest resolves them through moduleNameMapper
  // (expo-camera → src/__tests__/__mocks__/expo-camera.ts,
  //  expo-audio  → src/__tests__/__mocks__/expo-audio.ts).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Camera } = require('expo-camera') as typeof import('expo-camera');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expoAudio = require('expo-audio') as typeof import('expo-audio');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webrtc = require('@livekit/react-native-webrtc') as {
    permissions: { query: jest.MockedFunction<(d: { name: string }) => Promise<string>> };
    mediaDevices: {
      getUserMedia: jest.MockedFunction<
        (c: object) => Promise<{ getTracks(): { stop(): void }[] }>
      >;
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Alert } = require('react-native') as typeof import('react-native');

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { get: () => 'ios', configurable: true });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -- requestCameraPermission on iOS --

  it('returns "granted" directly when camera permission is already granted (iOS)', async () => {
    jest.spyOn(Camera, 'getCameraPermissionsAsync').mockResolvedValueOnce({
      status: 'granted',
      canAskAgain: true,
      expires: 'never',
      granted: true,
    });

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    expect(status).toBe('granted');
    expect(Camera.getCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    // requestCameraPermissionsAsync should NOT be called if already granted
    expect(Camera.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it('calls requestCameraPermissionsAsync when status is undetermined (iOS)', async () => {
    jest.spyOn(Camera, 'getCameraPermissionsAsync').mockResolvedValueOnce({
      status: 'undetermined',
      canAskAgain: true,
      expires: 'never',
      granted: false,
    });
    jest.spyOn(Camera, 'requestCameraPermissionsAsync').mockResolvedValueOnce({
      status: 'granted',
      canAskAgain: true,
      expires: 'never',
      granted: true,
    });

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    expect(status).toBe('granted');
    expect(Camera.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(result.current.cameraPermissionStatus).toBe('granted');
  });

  it('maps "restricted" when canAskAgain is false from requestCameraPermissionsAsync (iOS)', async () => {
    jest.spyOn(Camera, 'getCameraPermissionsAsync').mockResolvedValueOnce({
      status: 'undetermined',
      canAskAgain: true,
      expires: 'never',
      granted: false,
    });
    jest.spyOn(Camera, 'requestCameraPermissionsAsync').mockResolvedValueOnce({
      status: 'denied',
      canAskAgain: false,
      expires: 'never',
      granted: false,
    });

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    // canAskAgain: false → impl maps to 'restricted' (permanent iOS denial,
    // OS will never re-prompt; callers should redirect to Settings instead)
    expect(status).toBe('restricted');
    expect(result.current.cameraPermissionStatus).toBe('restricted');
  });

  // -- requestMicPermission on iOS --

  it('returns "granted" directly when mic permission is already granted (iOS)', async () => {
    webrtc.permissions.query.mockResolvedValueOnce('granted');

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestMicPermission();
    });

    expect(status).toBe('granted');
    expect(webrtc.permissions.query).toHaveBeenCalledWith({ name: 'microphone' });
    expect(webrtc.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('calls getUserMedia when mic is undetermined and grants permission (iOS)', async () => {
    webrtc.permissions.query.mockResolvedValueOnce('undetermined');
    const mockStop = jest.fn();
    webrtc.mediaDevices.getUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop: mockStop }],
    });

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestMicPermission();
    });

    expect(status).toBe('granted');
    expect(webrtc.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(mockStop).toHaveBeenCalled();
    expect(result.current.micPermissionStatus).toBe('granted');
  });

  it('maps "restricted" when iOS mic is permanently denied (iOS)', async () => {
    webrtc.permissions.query.mockResolvedValueOnce('denied');

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestMicPermission();
    });

    // 'denied' from webRTC permissions.query → impl maps to 'restricted'
    // (permanent iOS denial, OS will never re-prompt; callers redirect to Settings)
    expect(status).toBe('restricted');
    expect(result.current.micPermissionStatus).toBe('restricted');
  });

  // -- showPermissionDeniedAlert --

  it('shows camera denied Alert with "Open Settings" button when camera is denied on iOS', async () => {
    jest.spyOn(Alert, 'alert');
    jest.spyOn(Camera, 'getCameraPermissionsAsync').mockResolvedValueOnce({
      status: 'undetermined',
      canAskAgain: true,
      expires: 'never',
      granted: false,
    });
    jest.spyOn(Camera, 'requestCameraPermissionsAsync').mockResolvedValueOnce({
      status: 'denied',
      canAskAgain: false,
      expires: 'never',
      granted: false,
    });
    // Mic should not be called
    jest
      .spyOn(expoAudio, 'getRecordingPermissionsAsync')
      .mockResolvedValue({ status: 'granted', canAskAgain: true, expires: 'never', granted: true });

    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });

    // Connection must NOT have been attempted
    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.current.isChatConnected).toBe(false);
    // Alert must have been shown with camera denied message
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe(i18n.t('chat.permissionDeniedCameraTitle'));
  });

  it('shows mic denied Alert with "Open Settings" button when mic is denied on iOS', async () => {
    jest.spyOn(Alert, 'alert');
    // Camera: granted
    jest.spyOn(Camera, 'getCameraPermissionsAsync').mockResolvedValueOnce({
      status: 'granted',
      canAskAgain: true,
      expires: 'never',
      granted: true,
    });
    // Mic: permanently denied — iOS reports 'denied' from webRTC permissions.query
    webrtc.permissions.query.mockResolvedValueOnce('denied');

    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy });

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.current.isChatConnected).toBe(false);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe(i18n.t('chat.permissionDeniedMicTitle'));
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — getVideoTrackRef (#649, #651)
// ---------------------------------------------------------------------------

describe('getVideoTrackRef', () => {
  it('returns undefined when adapter has no getVideoTrackRef method', () => {
    const adapter = makeAdapter(); // StubVideoChatAdapter has no getVideoTrackRef
    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );
    expect(result.current.getVideoTrackRef('__local__')).toBeUndefined();
    expect(result.current.getVideoTrackRef('some-user-id')).toBeUndefined();
  });

  it('returns undefined when adapter getVideoTrackRef returns undefined', () => {
    const getVideoTrackRef = jest.fn().mockReturnValue(undefined);
    const adapter = makeAdapter({ getVideoTrackRef });
    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );
    expect(result.current.getVideoTrackRef('some-user-id')).toBeUndefined();
    expect(getVideoTrackRef).toHaveBeenCalledWith('some-user-id');
  });

  it('returns the track ref provided by adapter for a remote participant', () => {
    const fakeRef = { participant: {}, publication: {}, source: 'camera' };
    const getVideoTrackRef = jest.fn().mockReturnValue(fakeRef);
    const adapter = makeAdapter({ getVideoTrackRef });
    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );
    const ref = result.current.getVideoTrackRef('remote-user-id');
    expect(ref).toBe(fakeRef);
    expect(getVideoTrackRef).toHaveBeenCalledWith('remote-user-id');
  });

  it('returns the track ref for the local player using "__local__" sentinel', () => {
    const localRef = { participant: {}, publication: {}, source: 'camera' };
    const getVideoTrackRef = jest
      .fn()
      .mockImplementation((id: string) => (id === '__local__' ? localRef : undefined));
    const adapter = makeAdapter({ getVideoTrackRef });
    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );
    expect(result.current.getVideoTrackRef('__local__')).toBe(localRef);
    expect(result.current.getVideoTrackRef('other-user')).toBeUndefined();
  });

  it('delegates each call through to the adapter', () => {
    const getVideoTrackRef = jest.fn().mockReturnValue(undefined);
    const adapter = makeAdapter({ getVideoTrackRef });
    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );
    result.current.getVideoTrackRef('a');
    result.current.getVideoTrackRef('b');
    result.current.getVideoTrackRef('__local__');
    expect(getVideoTrackRef).toHaveBeenCalledTimes(3);
    expect(getVideoTrackRef).toHaveBeenNthCalledWith(1, 'a');
    expect(getVideoTrackRef).toHaveBeenNthCalledWith(2, 'b');
    expect(getVideoTrackRef).toHaveBeenNthCalledWith(3, '__local__');
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — iOS WebRTC camera-permission fallback (expo-camera not linked)
// Addresses Copilot PR-146 r2939751443.
//
// When expo-camera throws inside requestCameraPermission (e.g. native module
// not linked in an older dev-client binary), the impl falls back to
// @livekit/react-native-webrtc's permissions.query() + getUserMedia() which
// are always linked because the audio/video chat depends on it.
// ---------------------------------------------------------------------------

describe('useVideoChat — iOS WebRTC camera-permission fallback', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Camera } = require('expo-camera') as typeof import('expo-camera');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webrtc = require('@livekit/react-native-webrtc') as {
    permissions: { query: jest.MockedFunction<(d: { name: string }) => Promise<string>> };
    mediaDevices: {
      getUserMedia: jest.MockedFunction<
        (c: object) => Promise<{ getTracks(): { stop(): void }[] }>
      >;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { get: () => 'ios', configurable: true });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns "granted" via WebRTC query when expo-camera throws and permission is already granted', async () => {
    // Simulate expo-camera native module not linked
    jest
      .spyOn(Camera, 'getCameraPermissionsAsync')
      .mockRejectedValueOnce(new Error('expo-camera not linked'));
    webrtc.permissions.query.mockResolvedValueOnce('granted');

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    expect(status).toBe('granted');
    expect(result.current.cameraPermissionStatus).toBe('granted');
    expect(webrtc.permissions.query).toHaveBeenCalledWith({ name: 'camera' });
  });

  it('returns "restricted" via WebRTC query when expo-camera throws and permission is already denied', async () => {
    jest
      .spyOn(Camera, 'getCameraPermissionsAsync')
      .mockRejectedValueOnce(new Error('expo-camera not linked'));
    // 'denied' → iOS will not re-show the dialog → map to 'restricted'
    webrtc.permissions.query.mockResolvedValueOnce('denied');

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    expect(status).toBe('restricted');
    expect(result.current.cameraPermissionStatus).toBe('restricted');
  });

  it('returns "granted" via getUserMedia when expo-camera throws and status is undetermined', async () => {
    jest
      .spyOn(Camera, 'getCameraPermissionsAsync')
      .mockRejectedValueOnce(new Error('expo-camera not linked'));
    // 'undetermined' / 'prompt' → trigger getUserMedia to show OS dialog
    webrtc.permissions.query.mockResolvedValueOnce('undetermined');
    const mockStop = jest.fn();
    webrtc.mediaDevices.getUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop: mockStop }],
    });

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    expect(status).toBe('granted');
    expect(result.current.cameraPermissionStatus).toBe('granted');
    expect(webrtc.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(mockStop).toHaveBeenCalled(); // stream tracks released after permission obtained
  });

  it('returns "denied" when both expo-camera and the WebRTC fallback throw', async () => {
    jest
      .spyOn(Camera, 'getCameraPermissionsAsync')
      .mockRejectedValueOnce(new Error('expo-camera not linked'));
    webrtc.permissions.query.mockRejectedValueOnce(new Error('webrtc unavailable'));

    const { result } = renderHook(() => useVideoChat({ roomId: ROOM_ID, userId: USER_ID }));

    let status: MediaPermissionStatus = 'undetermined';
    await act(async () => {
      status = await result.current.requestCameraPermission();
    });

    expect(status).toBe('denied');
    expect(result.current.cameraPermissionStatus).toBe('denied');
  });
});

// ---------------------------------------------------------------------------
// Auto-restore chat prefs from AsyncStorage + autoConnect as listener
// ---------------------------------------------------------------------------

describe('useVideoChat — auto-restore chat prefs from AsyncStorage', () => {
  afterEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  it('restores camera + mic from AsyncStorage and connects on mount', async () => {
    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const enableCameraSpy = jest.fn().mockResolvedValue(undefined);
    const enableMicSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      connect: connectSpy,
      enableCamera: enableCameraSpy,
      enableMicrophone: enableMicSpy,
    });

    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ camera: true, mic: true })
    );

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Let the async restore IIFE resolve
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(connectSpy).toHaveBeenCalledWith(ROOM_ID, USER_ID);
    expect(enableCameraSpy).toHaveBeenCalled();
    expect(enableMicSpy).toHaveBeenCalled();
    expect(result.current.isChatConnected).toBe(true);
    expect(result.current.isLocalCameraOn).toBe(true);
    expect(result.current.isLocalMicOn).toBe(true);
    expect(result.current.cameraPermissionStatus).toBe('granted');
    expect(result.current.micPermissionStatus).toBe('granted');
  });

  it('does not connect when AsyncStorage has no stored prefs', async () => {
    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy });

    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.current.isChatConnected).toBe(false);
  });

  it('skips connect when stored prefs have both camera and mic disabled', async () => {
    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy });

    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ camera: false, mic: false })
    );

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.current.isChatConnected).toBe(false);
  });
});

describe('useVideoChat — autoConnect as listener', () => {
  afterEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  it('auto-connects in receive-only mode when autoConnect=true and no stored prefs', async () => {
    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy });

    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter, autoConnect: true })
    );

    // Two ticks: first for restore to finish (sets restoreFinished state),
    // second for autoConnect effect to fire.
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(connectSpy).toHaveBeenCalledWith(ROOM_ID, USER_ID);
    expect(result.current.isChatConnected).toBe(true);
    // No local tracks should be enabled (receive-only)
    expect(result.current.isLocalCameraOn).toBe(false);
    expect(result.current.isLocalMicOn).toBe(false);
  });

  it('does not auto-connect when autoConnect=false', async () => {
    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy });

    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter, autoConnect: false })
    );

    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.current.isChatConnected).toBe(false);
  });

  it('skips autoConnect when restore already connected with stored prefs', async () => {
    const connectSpy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ connect: connectSpy });

    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ camera: true, mic: false })
    );

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter, autoConnect: true })
    );

    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    // connect() should only be called once (by restore), NOT a second time by autoConnect
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isChatConnected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Persistence — toggles write/clear AsyncStorage
// ---------------------------------------------------------------------------

describe('useVideoChat — persistence on toggle', () => {
  beforeEach(() => {
    (AsyncStorage.setItem as jest.Mock).mockClear();
    (AsyncStorage.removeItem as jest.Mock).mockClear();
    if (typeof (PermissionsAndroid as any).request !== 'function') {
      (PermissionsAndroid as any).request = jest.fn();
    }
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls setItem when camera is toggled on (opt-in)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const adapter = makeAdapter();

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      expect.stringContaining(ROOM_ID),
      expect.stringContaining('"camera":true')
    );
  });

  it('calls removeItem when camera is toggled off (both off)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const adapter = makeAdapter();

    const { result } = renderHook(() =>
      useVideoChat({ roomId: ROOM_ID, userId: USER_ID, adapter })
    );

    // Opt in
    await act(async () => {
      await result.current.toggleVideoChat();
    });
    (AsyncStorage.setItem as jest.Mock).mockClear();
    (AsyncStorage.removeItem as jest.Mock).mockClear();

    // Opt out — both camera and mic off → removeItem
    await act(async () => {
      await result.current.toggleVideoChat();
    });

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(expect.stringContaining(ROOM_ID));
  });
});
