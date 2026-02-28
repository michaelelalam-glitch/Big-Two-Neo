# E2E Framework Recommendation: Maestro

**Task:** #611 — CI Audit Q6 Phase 4.1  
**Date:** 2026-02-28  
**Decision:** **Maestro** (over Detox)

---

## Evaluation Summary

| Criterion | Detox | Maestro |
|---|---|---|
| **Expo/EAS compatibility** | Requires `expo prebuild`, native project files | First-class Expo + EAS support, zero instrumentation |
| **App modification needed** | Yes (native build, Detox config inside app) | None — tests the final binary |
| **Test authoring** | JavaScript (Jest-like) | Declarative YAML |
| **New Architecture support** | Historically rocky, improving | Unaffected — works at accessibility layer |
| **CI runner requirement** | macOS for iOS, macOS or Linux for Android | macOS for iOS, Linux for Android |
| **CI cost (Android)** | macOS runner ~$0.08/min | Linux runner ~$0.008/min (10× cheaper) |
| **Setup complexity** | High (Xcode, Android SDK, native build step) | Low (single binary + `maestro test`) |
| **Synchronization** | Gray-box (aware of animations, network) | Black-box with built-in retry/tolerance |
| **Flakiness mitigation** | Deterministic sync with app idle state | `tolerance` and `retryTapIfNoChange` built-in |
| **Community** | Mature (Wix-maintained, 11k+ GitHub stars) | Growing rapidly (mobile.dev, 10k+ stars) |
| **Learning curve** | Moderate (JS + Detox API + native setup) | Low (YAML, visual element inspection) |

---

## Recommendation Rationale

### 1. Zero App Modification
Maestro tests the final `.app`/`.apk` binary. No npm packages to install, no native configuration changes, no build-time instrumentation. This is critical for an Expo-managed project where ejecting to bare workflow adds maintenance burden.

### 2. Expo/EAS Native Integration
Maestro explicitly documents full compatibility with Expo Go, development builds, and EAS Workflows. The `launchApp` command works directly with our bundle identifier (`com.big2mobile.app`).

### 3. CI Cost Efficiency
Our existing CI runs on `ubuntu-latest`. Maestro's Android E2E tests can run on the same Linux runner type (~$0.008/min), while Detox requires macOS runners (~$0.08/min) for both iOS and Android. For iOS E2E, both frameworks require macOS.

### 4. Simplicity & Maintainability
YAML test files are trivial to write, read, and maintain. No JavaScript boilerplate, no Jest configuration, no async/await patterns. Example:

```yaml
appId: com.big2mobile.app
---
- launchApp:
    clearState: true
- assertVisible: "Welcome to Big2"
- tapOn: "Sign in with Google"
```

### 5. New Architecture Compatibility
Our app uses `newArchEnabled: true` (Expo SDK 54, React Native 0.81.5). Maestro operates at the accessibility/view layer, completely independent of React Native bridge internals. This eliminates compatibility risk as the RN architecture evolves.

### 6. testID Support
Maestro natively supports React Native `testID` props via `id:` selector. Our codebase already uses testIDs in game components (`play-button`, `pass-button`, `sort-button`, etc.), which Maestro can target directly.

### 7. Local Development Experience
Maestro Studio provides visual element inspection and interactive flow authoring. Continuous Mode (`maestro test -c`) auto-reruns on YAML save. This makes test authoring significantly faster than Detox's compile-build-test cycle.

---

## Trade-offs Acknowledged

- **Black-box testing**: Maestro cannot synchronize with React Native's internal event loop like Detox's gray-box approach. Mitigated by Maestro's built-in retry mechanisms and explicit `waitForAnimationToEnd` commands.
- **Java dependency**: Maestro CLI requires Java 17+. Trivially installable in CI.
- **Less granular control**: Cannot access component state or mock network requests from tests. For those scenarios, we rely on our existing unit/integration test suite.

---

## Implementation Plan

| Phase | Task | Description |
|---|---|---|
| 4.1 | **This document** | Framework selection and rationale |
| 4.2 | Task #612 | Write Maestro E2E flows for critical game paths |
| 4.3 | Task #613 | Add E2E job to GitHub Actions CI pipeline |
