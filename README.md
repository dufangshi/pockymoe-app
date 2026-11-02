# Remote Codex App

Clients for [Pockymoe](https://github.com/dufangshi/pockymoe) (formerly Remote Codex): the [desktop client for macOS and Windows](desktop/README.md), and independent Android and iOS clients for relay mode, described below.

The mobile clients render the live relay product in a WebView, so devices, workspaces, workspace tabs, shortcuts, recent chats, thread search, Explorer, settings and the composer stay aligned with the website. Native code owns relay selection, safe areas/keyboard layout, attachment picking, saving/sharing exports and system notifications. There is no second native thread toolbar.

## Download

Signed Android APKs are published on [GitHub Releases](https://github.com/dufangshi/remote-codex-app/releases). Package id is `com.remotecodex.app` (this rewrite is not an in-place update of the old `com.remotecodex.android` APK).

## Screens

1. Relay URL
2. Relay home (`/`)
3. Setup guide (`/relay-guide`)
4. Sign in / create account (`/relay-portal`)
5. Devices (`/relay-devices`)
6. Account (`/relay-account`)
7. Workspaces (`/devices/:id/workspaces`)
8. New workspace (`/devices/:id/workspaces/new`)
9. Threads (`/devices/:id/threads?workspaceId=`)
10. New thread (`/devices/:id/threads/new`)
11. Import session (`/devices/:id/threads/import`)
12. Thread (`/devices/:id/threads/:id`) — WebView

Back navigation matches the web product header:

- Devices → Relay home
- Workspaces → Devices
- Threads → Workspaces
- Thread → Threads for that workspace
- New workspace / import → Workspaces
- New thread → Threads
- Account → previous screen
- Guide / portal → Relay home

## iOS thin shell

See [iOS shell and ActivityKit](docs/ios-shell.md) and the approved
[mobile design](docs/mobile-design.zh.md). The iOS target now uses the
`window.pockymoeHost` contract; the older mobile notes below describe Android
and the retired iOS implementation, not verification of the new shell.

Android now uses the thin `pockymoeHost` shell and one account Live Update; see [Android shell](docs/android-shell.md) for the contract, system limitations and isolated E2E commands.


## Login

The first native-only step is the relay URL. After that, session, register, and password sign-in match the web portal. For the older iOS shell, external OAuth is not yet supported end to end: provider pages open in the system browser, whose login cookies are separate from the app's WebView. Use password sign-in in this preview. Android implements the Custom Tab host handoff and requires the matching mobile Web/Relay proof exchange; live provider sign-in still needs separate verification. Passkey sign-in has not been validated in these native shells.

## Notifications

While signed in, the app reads the relay's durable account completion feed. It no longer depends on plaintext device WebSockets, which cannot monitor encrypted devices reliably. Per-session cursors survive reconnects, deduplicate notifications and suppress the currently open foreground thread. Taps open the exact device/thread; a notification from a different relay is ignored.

- Android polls every 4 seconds in a visible foreground monitoring service. Permission denial, force-stop and Android's background/dataSync time limits can prevent delivery. Reopening the app restarts monitoring. This is not FCM, and it does not promise delivery after the OS stops the service.
- iOS uses APNs when the relay and signed app are configured. Without APNs, the foreground watcher and best-effort background refresh cannot guarantee delivery while suspended. The shared notification settings explicitly report when APNs is unavailable.

For iOS production pushes, configure `REMOTE_CODEX_APNS_KEY_PATH` (a protected `.p8` file), `REMOTE_CODEX_APNS_KEY_ID`, `REMOTE_CODEX_APNS_TEAM_ID`, and `REMOTE_CODEX_APNS_TOPIC` (the signed bundle identifier) on the relay. Enable Push Notifications for the app's signing profile. Debug uses Apple's sandbox, Release uses production. Tokens register through the authenticated `/relay/account/notifications/native` endpoint and deliveries are revoked with the account session. Push payloads contain routing identifiers and generic completion copy, not decrypted prompts or responses.

iOS uses real Service Workers through `WKAppBoundDomains`. Supply Web hosts in the ignored `ios/Local.xcconfig`; Release fails without that setting. Hosts are readable in the distributed app. See [the iOS shell guide](docs/ios-shell.md). Native file exports have a 32 MB limit.


## Requirements

- JDK 21
- Android SDK 36.1 / Build Tools 36.1.0 and an AOSP API 37 emulator (API 36.1+ for explicit Live Update promotion) (no Google services)
- Xcode 16+ / 26+ with iOS Simulator
- A running Remote Codex relay that serves `apps/supervisor-web/dist`

## E2E

From this repo:

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export DEVELOPER_DIR="/Applications/Xcode-beta.app/Contents/Developer"

./scripts/e2e-backend.sh start
./scripts/e2e-android.sh
./scripts/e2e-ios.sh
./scripts/e2e-backend.sh stop
```

The backend helper starts an isolated relay + fake-runtime supervisor and writes `.local/e2e-env.json`. It clears inherited Supervisor environment variables and uses fresh temporary data directories. `serve` keeps it in the foreground for agent/terminal runners; `start`/`stop` are for scripts that retain the child processes.

Android's `ProductParityTest` runs on its own `pockymoe_aosp` AVD with the modern encrypted-account fixture. It checks real Web password login, device/workspace/thread navigation, the durable foreground-service event path, notification routing, message sending, IME geometry, predictive-back delivery, warm resume, account/settings, the native save picker, all three theme packs in light/dark, English/Chinese notification copy, bar-free terminal Live Updates, actual system promotion and offline recovery. It also records first-ever and configured light/dark force-stopped launches for frame inspection. A persisted splash-only theme matches the remembered page paint before the process starts. See [Android shell](docs/android-shell.md) for the exact commands and system limits. The focused iOS workflow passed on an iOS 18.5 simulator, including a real local system completion banner and navigation to the exact encrypted thread. These tests bootstrap a fixture session; they do not claim to validate all login methods. Simulator notification checks do not verify delivery through Apple's production APNs network; that final check needs the app's signing credentials and a physical device.

`node --test tests/native-bridge.test.mjs` checks the older shared asset bridge (the Android host is verified by instrumentation) without replacing fetch, authentication or Service Workers.
