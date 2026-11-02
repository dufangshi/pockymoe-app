# Android system shell

The Android entry point is one remote WebView. The application ID remains
`com.remotecodex.app` (`.debug` for development), and the label is Pockymoe.
The only local pages are Relay connection and offline/retry. The public Web/API
pair matches desktop (`app.lnz-study.com` / `remote.lnz-study.com`); stored legacy
public Relay URLs migrate to this pair. A self-hosted address uses that origin
for both services. Product navigation,
authentication, account settings, devices, workspaces and threads belong to Web.
The design authority is `docs/mobile-design.zh.md` on the mobile integration
branch; the Android branch does not own that document.

## Host boundary

`MainActivity` installs `pockymoe-host.js` at document start for the configured
HTTPS origin. AndroidX WebKit's message listener independently checks the exact
origin and `isMainFrame`; a same-origin iframe cannot invoke native methods.
There is no `addJavascriptInterface`, asset-hosted product, native API proxy or
WebViewAssetLoader. File and content URL access and mixed content are disabled.
Debug alone permits cleartext loopback/Android emulator host addresses. Web and
Relay origins are stored separately: only the Web origin receives the bridge,
while authentication and the durable feed use the Relay origin. Cross-origin
cookies are enabled in the WebView; only the configured Relay cookie is read
natively. `settings.set` validates either origin and reconnects when it changes.

`window.pockymoeHost` implements bridge version 2 with `surface: mobile`, Android
platform and `liveActivity`, `nativePush`, `haptics`. Android has no APNs/FCM
registration: `push.register()` returns null. `window.openThread` sends navigation
to the same page; preferences and pet methods are inert. Files use the system
picker, and external links use system handlers. Settings are local shell
preferences; connection-origin changes require validation and a new WebView.

System sign-in opens a Custom Tab for the configured Relay origin's `/relay/auth/*`
path. A pending call resolves only on a `pockymoe://auth` or legacy
`remotecodex://auth` return; closing the tab resolves null. The Web implementation
must validate its prepared callback ID/path and redeem the one-use handoff with
its retained proof. Provider cookies and native service credentials are never
sent to the page. OAuth requires the matching Web and Relay mobile-auth changes;
this shell alone cannot make an old Relay support that protocol.

The page supplies resolved appearance/background. The root retains that color
while a new WebView paints and fades in for 120 ms after a visual-state callback.
The system splash is logo-free, using the specified light/dark launch colors.
`WindowInsets` passes IME occlusion to modern WebView’s visual viewport without native panning; system bars are transparent.
AndroidX's predictive-back dispatcher sends the `back` host command. The Web owns
overlay/route handling; an unhandled or unresponsive page returns to the launcher.
A warm resume retains the WebView and route; recreation restores its history.

## One account notification

The existing foreground `dataSync` service reads the durable account workbench
feed every four seconds. It uses the HttpOnly WebView session cookie locally,
never exposes it through the host contract, and suppresses foreground events.
No Google Services or Firebase dependencies are needed.

The service and account activity share notification ID 41. Android 16+ uses the
SDK's `Notification.ProgressStyle` and `setShortCriticalText`. Explicit
`setRequestPromotedOngoing` is guarded by `SDK_INT_FULL >= BAKLAVA_1` (API 36.1);
the method does not exist on AOSP 36.0. Initial Android 16 keeps the progress
notification without this promotion request. Android 8–15 uses a normal ongoing notification.
`POST_PROMOTED_NOTIFICATIONS` is declared for API 36.1+. Promotion remains
controlled by Android, channel settings and user permission;
requesting promotion does not guarantee a status-bar chip.

Page `activity.sync` snapshots are the only source of thread titles, device names
and workspace labels. Cache and activity lifetime are stored in app-private,
non-backed-up preferences, separated by Relay and account. A bounded cache retains up to 512 page-supplied
active/recent names after they leave the active list; cached names never restart
work or cross account boundaries. Generic workbench
outcomes never replace those names. Child threads group under their conversation
and notification taps target the root. Unknown threads use “线程运行中”. Signing
out clears the cache and stops the watcher.

Activity begins with foreground running work. Priority is waiting, failure,
running. Waiting prevents completion. When active work ends, the final state
remains for 15 minutes, including across service/process reconstruction. A timer
then removes the promoted state; the unpromoted watcher remains while the
foreground service receives events. Android's foreground-service time limit,
force-stop or denied notification permission can prevent delivery.

The testable `AccountActivity` class owns grouping, priority, earliest timer,
account isolation, completion counting and retention, independent of Android.

### System-surface decisions

- Android notifications do not support the Web's looping ring animation: the
  converted static ring and Android's elapsed-time chronometer express running.
  This is the same justified exception as mobile design §6; the integration owner
  must also record it in the control-plane `docs/ui-principles.md` (read-only to
  this Android worker).
- Standard `ProgressStyle` controls its own layout. Local metadata is condensed
  into its content line (at most three conversations, then “其余 N 个”); pre-16
  notifications use the expanded text style. No custom notification layout or
  approval buttons are added.
- A foreground service must retain a notification after the activity's
  15-minute end. Its single notification becomes an ordinary watcher instead of
  leaving a promoted completed activity indefinitely.
- Android has no portable numeric launcher-badge API; `badge.set` is inert.
- WebView <136 cannot publish the required safe-area environment values. Those
  engines get native system-bar margins, painted with the page background, and
  one IME resize with its inset consumed. Modern engines keep their native bounds
  and adjust `visualViewport` themselves, avoiding a double keyboard offset.
- The agreed back command carries only a committed back action. AndroidX
  delivers predictive gestures; a Web route preview following gesture progress
  would require an additional page contract.
- Only resolved page appearance is persisted. The Android system's initial
  splash uses the design's fixed light/dark colors before application code runs.

## Local verification

Requires JDK 21, SDK 36.1, Build Tools 36.1.0 and an ARM64 AOSP API 37 image for promotion checks. API 36.0 is also accepted
via `ANDROID_SYSTEM_IMAGE=system-images;android-36;default;arm64-v8a` to exercise
the older progress-notification path.
Gradle/AGP are updated for this compile SDK. SDK API names can be checked directly
with `javap` against `platforms/android-36.1/android.jar`.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
(cd android && ./gradlew :app:assembleDebug :app:testDebugUnitTest)
E2E_RELAY_PORT=19890 E2E_SUPERVISOR_PORT=19891 E2E_WEB_PORT=19892 \
  REMOTE_CODEX_RELAY_WEB_DIST_DIR=/path/to/mobile-web/dist \
  scripts/e2e-backend.sh serve
# In another terminal, same worktree:
scripts/e2e-android.sh
scripts/e2e-backend.sh stop
```

The helper prefers the current `pockymoe` binary over the legacy build and uses
Node 22+ plus the control-plane Web dependency `hash-wasm` to generate a disposable
modern Argon2id/AES-GCM account fixture. Native instrumentation fills the native connection page and signs in through
the actual Web form, with no injected login token. In split mode, the DEBUG-only
`e2eWebUrl` intent selects the separate Web source while the connection field
continues to configure the Relay. The helper clears inherited
old and new Supervisor environment names and owns
fresh data on independent ports. `E2E_WEB_PORT` optionally starts a separate
SPA server; build the Web assets with `VITE_POCKYMOE_RELAY_ORIGIN` pointing at the
isolated Relay to exercise the same split as the deployed public site. The
helper refuses occupied ports and the managed Supervisor port. The Android script installs an AOSP image into
`.local/sdk`, creates its own `pockymoe_aosp` AVD in `.local/avd`, boots only
`emulator-5580` (override `ANDROID_EMULATOR_PORT` for a free port), targets that
serial for every adb command, and shuts it down on exit. It refuses an existing
instance at that port, never uses `cardverify_aosp35_root`, and never restarts a
shared adb server. Fixture credentials travel in a private file, not arguments.

Instrumentation results and screenshots are pulled into `.local/android-e2e/`.
`ProductParityTest` covers the Web shell and the DEBUG-only notification state
hook. For manual state inspection in a debug build on your own serial:

```bash
adb -s emulator-5580 shell am start -n com.remotecodex.app.debug/com.remotecodex.app.MainActivity \
  --es e2eNotificationState needsInput
```

Allowed states: `running`, `needsInput`, `failed`, `interrupted`, `completed`, `idle`.
The debug override holds these states despite page refreshes; `clear` releases it. Release
intents cannot enable this hook. Production Google/GitHub sign-in and physical
Android Live Update promotion still require separate real-device validation.
