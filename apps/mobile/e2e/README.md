# E2E Tests — Maestro

End-to-end tests for the Stephanos app using [Maestro](https://docs.maestro.dev/).

## Setup

### Install Maestro CLI (macOS)

```bash
curl -fsSL "https://get.maestro.mobile.dev" | bash
```

### Prerequisites
- Java 17+ (`java -version` to verify)
- iOS Simulator or Android Emulator running
- App installed on device (via `expo run:ios` or EAS build)

## Running Tests

### Run all flows (local — requires authentication)
```bash
maestro test e2e/flows/
```

### Run CI-safe flows only (no auth required)
```bash
maestro test --include-tags ci e2e/flows/
```

### Run a specific flow
```bash
maestro test e2e/flows/01_app_launch.yaml
```

### Continuous mode (re-runs on save)
```bash
maestro test -c e2e/flows/
```

### Run with tags
```bash
maestro test --include-tags smoke e2e/flows/
maestro test --include-tags critical-path e2e/flows/
```

## Test Flows

| Flow | Description | Tags | CI Safe |
|------|-------------|------|---------|
| `01_app_launch.yaml` | App launch + sign-in screen renders | smoke, auth, ci | ✅ |
| `02_game_selection.yaml` | Game selection + navigate to Home | smoke, navigation | ❌ |
| `03_home_navigation.yaml` | Home screen buttons + modals | smoke, navigation | ❌ |
| `04_create_room.yaml` | Create private room → Lobby | rooms, critical-path | ❌ |
| `05_join_room.yaml` | Join room UI + error handling | rooms, critical-path | ❌ |
| `06_offline_game.yaml` | Full offline bot game flow | game, critical-path | ❌ |
| `07_match_history.yaml` | Match history + leaderboard | navigation, history | ❌ |
| `08_settings_how_to_play.yaml` | Settings + How to Play screens | navigation | ❌ |
| `09_livekit_voice_video.yaml` | LiveKit voice/video toggles in-game | livekit, phase7 | ❌ |
| `10_sign_in_content_check.yaml` | Deep sign-in screen content validation | smoke, ci | ✅ |
| `11_app_relaunch_state.yaml` | App relaunch state persistence | smoke, ci | ✅ |
| `12_multiplayer_game_flow.yaml` | Full multiplayer lifecycle with bots | multiplayer, critical-path | ❌ |
| `13_sign_in_interaction.yaml` | Sign-in interactions + error handling | smoke, ci | ✅ |
| `14_app_stability_cold_starts.yaml` | 3-cycle cold start stability test | smoke, stability, ci | ✅ |

### CI vs Local Testing

**CI (GitHub Actions):** Runs 5 `ci`-tagged flows — validates app builds, installs,
boots, renders correctly, handles user interactions, and remains stable across multiple
cold starts. Covers: sign-in screen rendering, content assertions, privacy consent
modal (accept + decline paths), Google sign-in button interaction, and app stability
under repeated restarts.

**Local/Integration:** Run all flows after signing in manually or with pre-seeded auth state.
Flows 02-09, 12 exercise the full app: navigation, room creation, offline games, multiplayer
lifecycle, voice/video chat, and settings.

**Auth Gate:** Flows 02-12 require Google/Apple Sign-In which cannot be automated in CI.
To expand gameplay CI coverage, implement a CI auth bypass using email/password
authentication with a dedicated test account and `CI_TEST_MODE` environment variable.

## Writing New Tests

Tests are YAML files. Key commands:

```yaml
- launchApp:                    # Launch with clean state
    clearState: true
- tapOn: "Button Text"          # Tap by visible text
- tapOn:                        # Tap by testID
    id: "play-button"
- assertVisible: "Some Text"   # Assert text is visible
- assertVisible:                # Assert by testID
    id: "my-test-id"
- inputText: "ABC123"          # Type text
- back                         # Press back button
- takeScreenshot: "name"       # Capture screenshot
- extendedWaitUntil:           # Wait for element with custom timeout
    visible: "Loading..."
    timeout: 15000
```

See [Maestro Docs](https://docs.maestro.dev/reference) for full command reference.

## CI Integration

E2E tests run automatically on PRs via the `e2e` job in `.github/workflows/test.yml`. See the workflow file for configuration details.
