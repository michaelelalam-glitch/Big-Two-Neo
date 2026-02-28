# E2E Tests — Maestro

End-to-end tests for the Big2 Mobile app using [Maestro](https://docs.maestro.dev/).

## Setup

### Install Maestro CLI (macOS)

```bash
brew tap mobile-dev-inc/tap
brew install maestro
```

Or via curl:
```bash
curl -fsSL "https://get.maestro.mobile.dev" | bash
```

### Prerequisites
- Java 17+ (`java -version` to verify)
- iOS Simulator or Android Emulator running
- App installed on device (via `expo run:ios` or EAS build)

## Running Tests

### Run all flows
```bash
maestro test e2e/flows/
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

| Flow | Description | Tags |
|------|-------------|------|
| `01_app_launch.yaml` | App launch + sign-in screen renders | smoke, auth |
| `02_game_selection.yaml` | Game selection + navigate to Home | smoke, navigation |
| `03_home_navigation.yaml` | Home screen buttons + modals | smoke, navigation |
| `04_create_room.yaml` | Create private room → Lobby | rooms, critical-path |
| `05_join_room.yaml` | Join room UI + error handling | rooms, critical-path |
| `06_offline_game.yaml` | Full offline bot game flow | game, critical-path |
| `07_match_history.yaml` | Match history + leaderboard | navigation, history |
| `08_settings_how_to_play.yaml` | Settings + How to Play screens | navigation |

## Writing New Tests

Tests are YAML files. Key commands:

```yaml
- launchApp:                    # Launch with clean state
    clearState: true
- tapOn: "Button Text"          # Tap by visible text
- tapOn:                        # Tap by testID
    id: "play-button"
- assertVisible: "Some Text"   # Assert text is visible
- inputText: "ABC123"          # Type text
- back                         # Press back button
- takeScreenshot: "name"       # Capture screenshot
- extendedWaitUntil:           # Wait for element
    visible: "Loading..."
    timeout: 15000
```

See [Maestro Docs](https://docs.maestro.dev/reference) for full command reference.

## CI Integration

E2E tests run automatically on PRs via the `e2e` job in `.github/workflows/test.yml`. See the workflow file for configuration details.
