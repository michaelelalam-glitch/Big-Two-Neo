# LiveKit Camera & Microphone — Implementation Phases

> **Goal:** Both camera and microphone fully working in-game so all players can see and hear each other in real time via LiveKit SFU.

---

## Phase 1 — Scaffold & Interface Definition ✅ DONE
**PR:** #134  
**Branch:** `feature/649-651-livekit-voice-video-chat` (initial commits)

### What was done
- Defined `VideoChatAdapter` interface (`connect`, `disconnect`, `toggleCamera`, `toggleMic`, `onParticipantsChanged`, `onError`)
- Built `StubVideoChatAdapter` — no-op implementation for UI development in isolation
- Created `useVideoChat` hook skeleton wiring adapter lifecycle into React state
- Added `VideoTile` presentational component (renders a placeholder avatar + future video track slot)
- Plumbed `isInChatSession`, `participants`, `videoStreamSlot` through `GameContext` and `GameScreen`
- Added `GameSettingsModal` stubs for voice/video toggle buttons
- Added `PlayerInfo` avatar overlay slot for video status badge
- Set up 39-test unit suite foundation (`useVideoChat.test.ts`)

### State after this phase
- App builds and runs; voice/video buttons appear in settings modal
- No real audio/video — all calls are no-ops
- TypeScript interfaces locked; no breaking changes needed in future phases

---

## Phase 2 — Real Adapter, Edge Function & Voice-Only Mode ✅ DONE
**PR:** #139 (closed) → **#140** (active, all 9 Copilot comments resolved)  
**Branch:** `feature/649-651-livekit-voice-video-chat`  
**Commit:** `3d8a28d`

### What was done
- **`LiveKitVideoChatAdapter`** — real LiveKit SFU adapter:
  - Connects to LiveKit Cloud room via JWT token from Edge Function
  - Publishes microphone track; camera track optional (voice-only mode)
  - Handles `RoomEvent.Disconnected` with explicit empty-participant notification on disconnect and `UnexpectedDisconnectError` on surprise drops
  - Callback isolation: try-catch in `_notifyParticipants()` and `_notifyError()` loops so one bad callback cannot block others
- **`get-livekit-token` Supabase Edge Function** (`apps/mobile/supabase/functions/get-livekit-token/index.ts`):
  - Validates caller via `supabase.auth.getUser()` (anon-key client + the caller's `Authorization` Bearer JWT forwarded in the request headers — no service-role key required)
  - Validates `roomId` UUID format with regex
  - Checks caller is a member of the room in `room_players` table
  - Mints a time-limited LiveKit JWT with room + identity claims
  - Environment variables fail-fast with typed `string[]` error list
- **`useVideoChat` hook** — `toggleVoiceChat`, `toggleVideoChat`, `toggleCamera`, `toggleMic`, voice-only → video upgrade path
- **`GameSettingsModal`** — portrait mode wrapped in `ScrollView` for small devices; all accessibility labels via `i18n.t()`
- **`PlayerInfo`** — connecting spinner overlay; accessible labels using i18n
- **i18n** — 16 new `chat.*` keys: `joinVoice`, `leaveVoice`, `joinVideo`, `leaveVideo`, `muted`, `camera`, `microphone`, `audio`, `video`, `sectionTitle`, `connectingVideo`, `connectingVoice`, `tapTurnCameraOff`, `tapTurnCameraOn`, `tapMute`, `tapUnmute`
- **Tests:** 39 / 39 passing; TypeScript: 0 errors

### State after this phase
- Full adapter logic exists in JS/TS layer
- Edge function ready to be deployed
- UI shows voice/video connecting states
- **No native build yet** — simulator & Expo Go only; camera/mic streams not visible on real device

---

## Phase 3 — Native Build Configuration ✅ DONE
**PR:** #142  
**Branch:** `feature/649-651-livekit-phase3-native-config`

### What was done
- **`app.json`** is the source of truth for all native permissions. It already had `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, and Android `CAMERA`/`RECORD_AUDIO`/`MODIFY_AUDIO_SETTINGS` configured — no edits were needed. The generated native files (`ios/` and `android/`) are gitignored prebuild artifacts; they will reflect these values after `expo prebuild --clean`.
- **`eas.json`** — added a `developmentDevice` profile (`developmentClient: true`, `simulator: false`) for physical-device development-client builds.
- ~~Add `@livekit/react-native-webrtc` to the Expo plugin list in `app.json`~~ — **No plugin entry needed**: `@livekit/react-native-webrtc` uses Expo autolinking. iOS Podfile already uses `use_native_modules!`; Android `settings.gradle` already uses `expo-autolinking-settings`. Run `expo prebuild --clean` + `pod install` and the module links automatically.

### Remaining device steps (run once, not in source)
```bash
# From apps/mobile/
npx expo prebuild --clean    # regenerates ios/ and android/ from app.json
cd ios && pod install         # links @livekit/react-native-webrtc + other pods
cd ..
eas build --profile developmentDevice --platform ios
eas build --profile developmentDevice --platform android
```

### Definition of done
- `eas build --profile developmentDevice --platform ios` and `android` succeed without native linking errors
- App launches on physical device without crash on import of `@livekit/react-native`

---

## Phase 4 — Permission UX (Camera & Microphone) ✅ DONE
**PR:** [#145](https://github.com/michaelelalam-glitch/Big-Two-Neo/pull/145) (branch: `feature/649-651-livekit-phase4-permissions`, base: `game/chinese-poker`)

### What was done
- **`expo-camera@15.0.16`** added to dependencies and `app.json` plugins (SDK 54 compatible)
- **Real iOS camera permission** — replaced stub `return 'granted'` in `requestCameraPermission()` with:
  - `Camera.getCameraPermissionsAsync()` (check existing grant before prompting)
  - `Camera.requestCameraPermissionsAsync()` (only called when status is undetermined/denied)
- **Real iOS mic permission** — replaced stub in `requestMicPermission()` with:
  - `Audio.getPermissionsAsync()` (check existing grant)
  - `Audio.requestPermissionsAsync()` (only when undetermined/denied)
- **`showPermissionDeniedAlert(permissionType)`** — helper that shows `Alert.alert` with:
  - Localized title + message (10 new `chat.*` i18n keys in en/ar/de)
  - "Open Settings" button wired to `Linking.openSettings().catch(() => {})` deep-link (`.catch()` guards against MDM/Settings-unavailable rejections)
  - "Cancel" button
  - Early-return guard for non-native platforms (web has no Settings; `Linking.openSettings` is unimplemented) so the alert is never shown where it would be misleading
- **Permission guards** — both camera AND mic are now required to start video chat:
  - Camera denied → alert + early return (no connection attempt)
  - Mic denied → alert + early return (no connection attempt)
  - Same guards in `toggleMic`, `toggleVoiceChat`, and `toggleCamera`
- **i18n** — 10 new `chat.*` keys: `cameraPermissionTitle`, `cameraPermissionMessage`, `micPermissionTitle`, `micPermissionMessage`, `permissionDeniedCameraTitle`, `permissionDeniedCameraMessage`, `permissionDeniedMicTitle`, `permissionDeniedMicMessage`, `openSettings` (+ inherited `common.cancel`)
- **Jest mocks** — `expo-camera` mock added, `expo-av` mock extended with permission APIs, `react-native` mock extended with `Linking`
- **Tests** — 8 new Phase 4 iOS permission tests; all 49 `useVideoChat` tests passing (1200+ total unit tests pass)

### Definition of done
- First time a user tries to join a voice/video session the OS permission dialog appears ✅
- Denying permission shows an explanatory alert and does not crash ✅
- "Open Settings" deep-link takes user directly to app settings ✅
- Re-joining after granting permission in Settings works without restart ✅

---

## Phase 5 — Video Track Rendering (See Each Other) ✅ DONE
**Branch:** `feature/649-651-livekit-phase5-video-rendering`

### What was done
- Added `LiveKitTrackRef` interface (SDK-agnostic structural mirror of `TrackReference`) to `useVideoChat.ts`
- Added `getVideoTrackRef(participantId: string | '__local__'): LiveKitTrackRef | undefined` to `VideoChatAdapter` interface and `UseVideoChatReturn`
- Implemented `getVideoTrackRef` in `LiveKitVideoChatAdapter.ts` using `getTrackPublication(Track.Source.Camera)`
- Created `LiveKitVideoSlot.tsx` — presentational wrapper around `<VideoTrack>` from `@livekit/react-native` v2.9.6 with module-level lazy load guard (safe in Expo Go)
- Added `remotePlayerIds: readonly string[]` to `GameContext` — maps display positions [top, left, right] to LiveKit participant identities, computed per-game in `MultiplayerGame.tsx`
- Wired `videoStreamSlot` in `GameLayout.tsx` → `PlayerInfo` for all remote player positions and the local player
- `GameView.tsx` builds per-player video slots using `remotePlayerIds` from context (seat-layout-aware, not key-order fragile)
- `LocalAIGame.tsx` provides stub no-ops; `MultiplayerGame.tsx` provides real implementation

### Definition of done
- In a 2-player (or 4-player) game session with video enabled, each player's camera feed appears in the other player's `PlayerInfo` avatar slot
- Toggling camera off reverts to avatar fallback immediately
- No ANR or memory leak after 10 minutes of active video session (spot-checked in Xcode Instruments / Android Profiler)

---

## Phase 6 — Deploy Edge Function & Secrets 🔲 TODO

### What needs to happen
- Set Supabase project secrets (production + staging):
  ```
  LIVEKIT_API_KEY=<your key>
  LIVEKIT_API_SECRET=<your secret>
  LIVEKIT_URL=wss://<your-project>.livekit.cloud
  ```
- Deploy the `get-livekit-token` edge function:
  ```bash
  supabase functions deploy get-livekit-token --project-ref <ref>
  ```
- Verify the function is reachable from the app via `supabase.functions.invoke('get-livekit-token', ...)`
- Set up a LiveKit Cloud project if not already done (free tier supports development)
- Add CORS header to edge function response if needed for local testing

### Definition of done
- `curl` to the deployed function with a valid auth token returns a signed JWT
- App successfully exchanges the JWT for a LiveKit room session on a real device

---

## Phase 7 — Integration & E2E Testing (Full Feature Complete) 🔲 TODO

### What needs to happen
- **Multi-device test matrix** (minimum: 2 iOS or Android devices):
  - Two players join the same game → both can hear each other (voice-only)
  - One or both enable camera → video feeds appear in the other player's avatar slot
  - One player toggles camera off → other player's UI reflects the change immediately
  - One player mutes → mic icon updates; other player hears silence
  - One player force-kills the app → remaining player sees participant count drop and no crash
  - Network interruption recovery (airplane mode toggle) — should surface `UnexpectedDisconnectError` UI
- Add Detox or device-farm E2E spec for the happy path (voice join → play a turn → leave)
- Verify no audio routing issues (speaker vs earpiece; Bluetooth headset hand-off)
- 4-player stress test: all four cameras + mics active simultaneously

### Definition of done
- All manual test matrix cases pass on at least one iOS and one Android device
- No P0 crash in Crashlytics / Sentry after a 24 h soak with 2+ simultaneous sessions
- Feature flagged off in production until soak completes (or released behind a settings toggle)

---

## Summary Table

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Scaffold & interface definition (PR #134) | ✅ Done |
| 2 | Real adapter + Edge Function + voice-only mode (PR #140) | ✅ Done |
| 3 | Native build configuration (prebuild, CocoaPods, Gradle) | ✅ Done (PR #142) |
| 4 | Permission UX — camera & microphone OS dialogs | ✅ Done (PR [#145](https://github.com/michaelelalam-glitch/Big-Two-Neo/pull/145)) |
| 5 | Video track rendering — `<VideoView>` in player avatars | 🔲 Todo |
| 6 | Deploy Edge Function & set production LiveKit secrets | 🔲 Todo |
| 7 | Integration & E2E testing — multi-device, stress test | 🔲 Todo |

---

_Last updated: Phase 4 complete — PR [#145](https://github.com/michaelelalam-glitch/Big-Two-Neo/pull/145) merged; 49/49 useVideoChat tests passing_
