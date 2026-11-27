# Agent notes

This repo holds the Pockymoe (formerly Remote Codex) client apps: `android/` and `ios/` WebView shells, and the `desktop/` Electron client for macOS and Windows. It is not the control-plane repo. The former native SwiftUI macOS client is retired; do not reintroduce it.

Desktop (`desktop/`): the main window loads the Web UI; spec in `docs/desktop-design.zh.md`, host bridge in `desktop/src/shared/contract.ts`, run and QA commands in `desktop/README.md`.

Mobile:

- Keep the native shell aligned with `apps/supervisor-web` in remoteCodex: same route stack, back targets, labels, and theme tokens.
- Thread conversation stays in a WebView of the relay-hosted thread page. Do not reimplement timeline/composer natively.
- 2026-11-26: the owner asked for a separate native Android/iOS client in `native/` (Expo/React Native, see `native/ARCHITECTURE.md`); the WebView-only rule above applies to `android/` and `ios/`, not to `native/`. Its app id is `com.pockymoe.app` (`.dev`/`.preview` for those builds); the shells keep `com.remotecodex.app`, so both install side by side. 2026-11-27: the native apps ship beside the WebView ones: client releases carry `Pockymoe-Native-<version>-android.apk` (same key and version as the WebView APK); iOS has no release file until there is an Apple developer account (free-Apple-ID install: `native/docs/ios-install-personal.md`). After `native/` changes, run its checks (`cd native && npx tsc --noEmit && npx vitest run`) and the Android emulator or x86sim iOS checks for UI changes.
- Relay mode only. The first screen collects the relay origin; after that, auth is `/relay/auth/*`.
- JSON field names are camelCase.
- After Android or iOS changes, run the matching simulator E2E, not a web Playwright suite.
