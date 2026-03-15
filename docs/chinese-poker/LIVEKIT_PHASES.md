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

## Phase 3 — Native Build Configuration 🔲 TODO

### What needs to happen
- Run `expo prebuild --clean` to generate the `/ios` and `/android` native projects from the current `app.json` config
- ~~Add `@livekit/react-native-webrtc` to the Expo plugin list in `app.json`~~ — **No plugin entry needed**: `@livekit/react-native-webrtc` uses Expo autolinking and does **not** require a manual entry in `app.json` plugins. `LiveKitVideoChatAdapter.ts` documents this explicitly. Run `expo prebuild --clean` and autolinking will resolve the native module automatically.
- **iOS:** Run `pod install` in `/ios`; agree to microphone + camera usage description entries in `Info.plist`
- **Android:** Confirm `CAMERA` and `RECORD_AUDIO` permissions are in `AndroidManifest.xml`; check Gradle dependency resolution for `livekit-android`
- Build and run on a real device (not Expo Go — native modules require a custom dev client or a production build)
- Smoke-test: can two devices join the same LiveKit room? (audio only at this point)

### Definition of done
- `eas build --profile development --platform ios` and `android` succeed without native linking errors
- App launches on physical device without crash on import of `@livekit/react-native`

---

## Phase 4 — Permission UX (Camera & Microphone) 🔲 TODO

### What needs to happen
- Replace stub `return 'granted'` in the camera/mic permission helpers with real calls:
  - `expo-camera`: `Camera.requestCameraPermissionsAsync()` / `Camera.getCameraPermissionsAsync()`
  - `expo-av`: `Audio.requestPermissionsAsync()` / `Audio.getPermissionsAsync()`
- Handle all permission states: `granted`, `denied`, `restricted`, `undetermined`
- For `denied` / `restricted`: show a user-facing alert with a "Go to Settings" deep-link (`Linking.openSettings()`)
- Write unit tests for permission-denied and restricted paths

### Definition of done
- First time a user tries to join a voice/video session the OS permission dialog appears
- Denying permission shows an explanatory alert and does not crash
- Re-joining after granting permission in Settings works without restart

---

## Phase 5 — Video Track Rendering (See Each Other) 🔲 TODO

### What needs to happen
- Connect the `videoStreamSlot` prop in `PlayerInfo` / `VideoTile` to actual LiveKit `RemoteTrackPublication` objects from `useVideoChat`
- Use `@livekit/react-native`'s `<VideoView track={...} />` component inside `VideoTile`
- Handle track subscribe/unsubscribe lifecycle: show avatar fallback when no video track is available
- Support local video preview (local participant's own camera) — show mirrored
- Handle dominant-speaker highlighting (optional but improves UX)

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
| 3 | Native build configuration (prebuild, CocoaPods, Gradle) | 🔲 Todo |
| 4 | Permission UX — camera & microphone OS dialogs | 🔲 Todo |
| 5 | Video track rendering — `<VideoView>` in player avatars | 🔲 Todo |
| 6 | Deploy Edge Function & set production LiveKit secrets | 🔲 Todo |
| 7 | Integration & E2E testing — multi-device, stress test | 🔲 Todo |

---

_Last updated: after PR #140 merge-ready commit `3d8a28d`_
