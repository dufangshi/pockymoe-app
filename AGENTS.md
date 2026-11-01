# Agent notes

This repo holds the Pockymoe (formerly Remote Codex) client apps: `android/` and `ios/` WebView shells, and the `desktop/` Electron client for macOS and Windows. It is not the control-plane repo. The former native SwiftUI macOS client is retired; do not reintroduce it.

Desktop (`desktop/`): the main window loads the Web UI; spec in `docs/desktop-design.zh.md`, host bridge in `desktop/src/shared/contract.ts`, run and QA commands in `desktop/README.md`.

Mobile:

- Keep the native shell aligned with `apps/supervisor-web` in remoteCodex: same route stack, back targets, labels, and theme tokens.
- Thread conversation stays in a WebView of the relay-hosted thread page. Do not reimplement timeline/composer natively.
- Relay mode only. The first screen collects the relay origin; after that, auth is `/relay/auth/*`.
- JSON field names are camelCase.
- After Android or iOS changes, run the matching simulator E2E, not a web Playwright suite.
