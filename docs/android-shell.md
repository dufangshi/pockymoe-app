# Android system shell

The Android entry point is one remote WebView. The application ID remains
`com.remotecodex.app` (`.debug` for development), and the label is Pockymoe.
The only local pages are connection and offline/retry. No service address is
shipped. First launch asks for a service address with `https://app.example.com`
as a placeholder, plus an Advanced override for a separate Relay address. A
credential-free HTTPS probe follows redirects (at most six requests) and verifies
the final Pockymoe HTML. A redirected address is the Relay; the final origin is
Web. A direct Web address serves both unless overridden. Bad addresses or network
failures stay beside the connection field as one line, with no offline detour.
Stored explicit Web/Relay pairs are kept exactly. A legacy single stored address
is probed automatically once; failure returns to the prefilled connection form.
Connection and offline pages follow system language and light/dark mode, using
launch backgrounds #FAFAF8 / #17171A and matching system-bar icons. Their content
is centered slightly above the middle, with 24dp side margins and a 420dp maximum
width. The 56dp app icon sits 16dp above the 22sp semibold title and muted 14sp
subtitle. Fields are 48dp tall with 12dp corners, 14dp horizontal padding, muted
borders and Classic-accent focus borders; URL keyboards disable suggestions and
capitalization, and Go submits. Errors occupy one reserved 13sp danger-colored
line. Connect is a fixed 48dp Classic-accent primary button, visibly disabled when
empty, with a small spinner replacing its label during probing. Advanced is a
quiet 44dp text action below it and expands the optional Relay field. Offline
uses the same styles with primary Retry and quiet Change address. A scroll
container keeps fields reachable with the keyboard or at small heights.
Product navigation, authentication, account settings, devices, workspaces and threads belong to Web.
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
while the durable feed uses the Relay origin. Cross-origin cookies are enabled
in the WebView. Native session-cookie lookup is restricted to the configured Web
and Relay origins, preferring the Web host for deployments with an API proxy.
Once a cookie source is found, it stays pinned to that origin so sign-out cannot
fall back to a stale cookie on the other host. Tokens never reach the page.
`settings.set` rejects all keys except `alertMode` and `snoozeUntil`, including
origin keys even when unchanged. Only native connection setup changes origins.
Host case and default ports are canonicalized before origin comparisons.

`window.pockymoeHost` implements bridge version 2 with `surface: mobile`, Android
platform and `liveActivity`, `nativePush`, `haptics`. Android has no APNs/FCM
registration: `push.register()` returns null. `window.openThread` sends navigation
to the same page; preferences and pet methods are inert. Files use the system
picker, and external links use system handlers. Settings are local shell
preferences. Native connection-origin changes require a successful probe and a
new WebView. Network failures and main-frame 5xx show offline; Pages-style 404
HTML remains the application, including restored routes and notification taps.

System sign-in opens a Custom Tab for `/relay/auth/*` on the configured Web or
Relay origin. The activity is `singleTask`; both cold creation and `onNewIntent`
handle `/callback` returns to `pockymoe://auth` or legacy `remotecodex://auth`.
A pending call resolves into its existing document; closing the tab resolves
null. If that document/proof is gone, the callback is not replayed or redeemed:
the real Web sign-in page shows its existing AuthNotice with one localized line
asking the person to sign in again. The Web implementation
must validate its prepared callback ID/path and redeem the one-use handoff with
its retained proof. Provider cookies and native service credentials are never
sent to the page. OAuth requires the matching Web and Relay mobile-auth changes;
this shell alone cannot make an old Relay support that protocol.

The last opaque page background is selected before `super.onCreate` and applied
to the activity window, root and WebView. With no saved background, the system
night setting selects `#17171A` or `#FAFAF8`. The WebView remains at alpha zero
until its document has committed, the page has supplied appearance paint and a
visual-state callback confirms that appearance revision. Only then does it fade
in over 120 ms. Stale navigation/appearance callbacks cannot reveal a newer page.

On Android 12+, `SplashScreen.setSplashScreenTheme` persists one of the stable
`Theme.RemoteCodex.StartupDark` / `StartupLight` resource names as the page paints.
Android can therefore select the correct logo-free system starting window before
the next app process exists. No app-wide night override is set: Web system-theme
media queries continue to follow the OS. A first-ever launch retains the manifest's
system-qualified splash. The exit listener removes the splash over the already
painted root, rather than fading a light system view over a dark cache. Pre-31
launch previews are disabled so the cached native window provides the first app
surface instead of an unconfigurable light preview.
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
SDK's indeterminate `Notification.ProgressStyle` for running work and bar-free
`BigTextStyle` for waiting/failed/interrupted/completed states. Both styles retain
promotable characteristics; no numeric percentage or determinate terminal bar is
sent. `setShortCriticalText` supplies the capsule label. Explicit
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

`NotificationCopy` resolves the three display lines from the current page locale
at render time (English and Chinese). The title is the page-owned thread title,
or “线程运行中” / “Thread running” only when missing. The text is device · workspace.
The expanded final line is the state: running alone, other running conversations,
waiting, failure (plus other running conversations), or interruption. Zero other
threads are never announced. Completion uses the completed-count phrase as its
title and has no second state copy. No subtext repeats these facts. Running keeps
its framework chronometer beside the title. Capsule labels/counts are unchanged.
Locale-only appearance changes repaint the existing notification.

The testable `AccountActivity` class owns grouping, priority, earliest timer,
account isolation, completion counting and retention, independent of Android.

### System-surface decisions

- Android notifications do not support the Web's looping ring animation: the
  converted static ring and Android's elapsed-time chronometer express running.
  This is the same justified exception as mobile design §6; the integration owner
  must also record it in the control-plane `docs/ui-principles.md` (read-only to
  this Android worker).
- Standard notification templates control layout. Running uses indeterminate
  `ProgressStyle`; other states use `BigTextStyle` to avoid suggesting measurable
  progress or a full completed bar. Title, device/workspace and state each have
  their own line. No custom notification layout or approval buttons are added.
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
- Only resolved page paint and the platform's selected splash resource are
  persisted. The splash uses the fixed design colors; the native window and
  hidden WebView use the exact last page color until first paint. Splash-only
  persistence does not change application or system night mode.

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
# Build the integration Web without a fixed Relay for the same-origin API proxy case:
# (in the integration checkout) POCKYMOE_RUNTIME_RELEASE=1 VITE_POCKYMOE_RELAY_ORIGIN='' pnpm --filter @pockymoe/supervisor-web build
E2E_WEB_HOST=localhost E2E_RELAY_UPSTREAM_PORT=19893 \
  E2E_RELAY_PORT=19890 E2E_SUPERVISOR_PORT=19891 E2E_WEB_PORT=19892 \
  REMOTE_CODEX_ROOT=/Users/mac/dev/remoteCodex.worktrees/mobile-host \
  REMOTE_CODEX_RELAY_WEB_DIST_DIR=/Users/mac/dev/remoteCodex.worktrees/mobile-host/apps/supervisor-web/dist \
  scripts/e2e-backend.sh serve
# In another terminal, same worktree:
scripts/e2e-android.sh
scripts/e2e-backend.sh stop
```

The helper defaults to Relay 18790, Supervisor 18791, Web 18792 and private Rust
upstream 18793, with different Web/Relay cookie hosts. It uses the mobile-host
integration checkout and prefers its
current `pockymoe` binary over a legacy build and uses
Node 22+ plus the control-plane Web dependency `hash-wasm` to generate a disposable
modern Argon2id/AES-GCM account fixture. Native instrumentation fills the native connection page and signs in through
the actual Web form, with no injected login token. Fresh-install and full-flow
tests enter the Web service and separate Relay through the visible connection
fields. The helper pins a copy of the supplied generated Web dist in the disposable
backend directory before starting it, so parallel rebuilds cannot change the
assets under a running test. `.local/review-web-build.json` records the source
commit and index digest. The helper clears inherited
old and new Supervisor environment names and owns
fresh data on independent ports. `E2E_WEB_PORT` optionally starts a separate
SPA server. Its missing deep paths return real HTTP 404 HTML, matching Pages.
The documented fixture uses Web at localhost:19892 and Relay at
127.0.0.1:19890, so cookie hosts differ. The current Web reads that Relay origin
from the host and calls it directly; the native service uses the same Relay.
`E2E_RELAY_UPSTREAM_PORT=19893` places the real isolated Rust relay behind a
loopback HTTP/WebSocket proxy. These two local hostnames are different sites:
only this test proxy changes Set-Cookie from SameSite=Lax to SameSite=None,
retaining Secure and HttpOnly. For the explicitly configured Web origin only,
it also translates cross-site Sec-Fetch-Site to same-site; Origin itself stays
unchanged and the real Relay still validates it. This emulates the site
relationship of HTTPS sibling hosts, rather than testing production cookie/CSRF
policy under local HTTP. Real HTTPS sibling hosts keep the production Lax policy. No production setting or cookie policy is changed. The independent
fixture control API uses 127.0.0.1:19893; the Android helper reverses that port too.
`E2E_WEB_RELAY_PROXY=1` is an optional same-origin Web proxy for older Web builds
that address APIs through their Web host. The
helper refuses occupied ports and the managed Supervisor port. The Android script installs an AOSP image into
`.local/sdk`, creates its own `pockymoe_aosp` AVD in `.local/avd`, boots only
`emulator-5580` (override `ANDROID_EMULATOR_PORT` for a free port), targets that
serial for every adb command, and shuts it down on exit. It refuses an existing
instance at that port, never uses `cardverify_aosp35_root`, and never restarts a
shared adb server. It may dismiss only a System UI or Quickstep boot ANR before
testing; an app ANR is never dismissed by this recovery. Fixture credentials travel in a private file, not arguments.

Instrumentation results, native integration observations and screenshots are
pulled into `.local/android-e2e/`. `ProductParityTest` asserts mobile capabilities,
absence of desktop chrome, sheet-first back, CSS Color 4 background resolution,
status-bar icon appearance, and exactly the three allowed haptic moments. Real
fake-runtime start/approval events drive the page's `activity.sync`, and the
notification must contain that real thread title. The suite also verifies forbidden
settings patches, one-field 307 discovery, automatic legacy probing, editable
first-connect errors, offline address correction, and live/cold OAuth returns.
The cold OAuth case launches the app outside instrumentation, backgrounds it
under the system browser, kills only its process with `am kill`, then verifies
the callback starts a different process and displays the lost-proof notice.
A DEBUG-only `e2eAuthUrl` intent drives the real bridge to the private browser
fixture; it supplies no proof, session or provider tokens. DEBUG state previews reuse its
page-owned metadata and verify both languages, indeterminate running, bar-free
other states and system promotion.

The script force-stops the test app and uses `adb shell screenrecord` for four
launches: first-ever system dark (`cold-first-dark.mp4`), first-ever system light
(`cold-first-launch.mp4`), cached dark with a light system (`cold-web-dark.mp4`),
and cached light (`cold-web-light.mp4`). Fresh installs reset OS-persisted splash
preferences between the two first-ever cases. The system-follow test verifies
that OS theme changes keep the same WebView/document. Per-recording `*-layers.log`
files contain DEBUG paint colors, alpha and monotonic timing, never URLs or
session contents. Recordings must still be decoded and visually inspected;
passing instrumentation alone is not proof of no startup flash. For manual state inspection in a debug build on your own serial:

```bash
adb -s emulator-5580 shell am start -n com.remotecodex.app.debug/com.remotecodex.app.MainActivity \
  --es e2eNotificationState needsInput
```

Allowed states: `running`, `needsInput`, `failed`, `interrupted`, `completed`, `idle`.
The debug override holds these states despite page refreshes; `clear` releases it. Release
intents cannot enable this hook. Production Google/GitHub sign-in and physical
Android Live Update promotion still require separate real-device validation.

Fresh-install E2E asserts that empty storage shows the native connection page
without a WebView or app HTTP requests, then enters the isolated local Web and
Relay origins through the visible fields. DEBUG-only instrumentation records
origin names (never paths, query strings, headers or tokens) for connection
probes, WebView, service-worker and native workbench requests. The test rejects destinations
outside the entered origins; it does not monitor unrelated emulator OS traffic.

For the connection-only acceptance run, use
`ANDROID_CONNECTION_ONLY=1 scripts/e2e-android.sh` with the isolated backend above. It retains the existing
fresh-install and legacy/probe/error cases, then captures the actual native
component in English/Chinese and light/dark at phone and 320dp widths. Visual
states include empty/disabled, Advanced, probing spinner, error and offline.
The visual tests render the same native component with isolated locale/mode
contexts; the production activity always uses system configuration.
