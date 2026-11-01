# Pockymoe desktop

Standalone Electron 45 client, TypeScript + electron-vite. The main window loads
Pockymoe's Web UI; preferences, connection setup, quick window and pet are local
sandboxed windows. The frozen host contract is `src/shared/contract.ts` (v2).

```sh
cd desktop
pnpm install
pnpm dev

# Separate Web and Relay development origins:
POCKYMOE_DESKTOP_WEB_ORIGIN=http://127.0.0.1:18901 \
POCKYMOE_DESKTOP_RELAY_ORIGIN=http://127.0.0.1:18900 pnpm dev

# A local relay that also serves the Web UI:
POCKYMOE_DESKTOP_WEB_ORIGIN=http://127.0.0.1:18900 \
POCKYMOE_DESKTOP_RELAY_ORIGIN=http://127.0.0.1:18900 pnpm dev
```

The ports above are examples; this package never starts or restarts a Supervisor.
Defaults are Web `https://app.lnz-study.com` and Relay
`https://remote.lnz-study.com`. `POCKYMOE_DESKTOP_USER_DATA` selects an isolated
app profile. Setting Web origin bypasses first run. HTTPS is required except on
loopback (`localhost`, `127.0.0.1`, `[::1]`).

## Install and use

macOS: open the DMG and copy **Pockymoe.app** to Applications, or extract the ZIP.
Windows: run the NSIS installer, choose an install directory if needed, then open
Pockymoe from the Start menu. The development-signed macOS builds produced by the
QA command below are **not notarized** and are for local developer testing;
normal distribution requires a Developer ID signature and notarization. Windows
builds without an Authenticode certificate are unsigned.

On first launch, enter your Pockymoe address. The normal hosted Web address is
`https://app.lnz-study.com`; its Relay is `https://remote.lnz-study.com`. For a
self-hosted installation, use **Advanced** to enter Web and Relay separately, or
use the same origin for both when the Relay also serves the UI. Sign in with your
existing account; this client does not install or replace a device Supervisor.

Use **Pockymoe → Preferences…** (Cmd/Ctrl+,) or the tray's Preferences entry to
change the connection, launch at login, alerts, pet and shortcut. In Pet settings,
Import… accepts a Codex pet folder or ZIP containing `pet.json` and its sprite
sheet. Show pet, size, mini mode and sound take effect immediately. Alt+Space
opens the quick window by default; choose another accelerator in Shortcuts if
that key is already used. Closing the main window keeps the app in the menu bar
or tray. Cmd/Ctrl+Q or Quit Pockymoe exits.

## Connection discovery

First run asks for **Pockymoe 地址**, accepting a Web origin or Relay origin.
Discovery reads the existing upstream deployment metadata:

- GitHub Pages `STATIC_HOSTING.txt` has `Relay API origin: <origin>`, emitted by
  `apps/supervisor-web/staticHosting.ts` from `VITE_POCKYMOE_RELAY_ORIGIN`.
- If the text asset is unavailable, the generated HTML meta CSP's `connect-src`
  supplies candidate Relay origins. Candidates must answer `/healthz` with
  `{ "status": "ok" }`.
- An API-only Relay's `/` redirects to its configured `POCKYMOE_WEB_ORIGIN`.
  The entered Relay is then health-checked separately. A same-origin Relay
  serving the UI resolves both fields to itself.

Discovery omits credentials, bounds downloads to 2 MB, times out individual
requests, validates every redirect and never executes returned HTML/scripts.
Custom hosts without that metadata can use **高级** to specify both origins
explicitly. Preferences displays the current pair and opens the same form for
changes. No new backend endpoint is required.

The app is `Pockymoe` (`com.pockymoe.desktop`); `pockymoe://` is the primary
protocol and `remotecodex://` is accepted for compatibility. Existing JSON
settings under the old `Remote Codex` user-data directory are copied once if no
Pockymoe settings exist. A v1 custom relay maps to both origins; the old production
Relay default maps to the new production Web/Relay pair. Credentials/keys are
never inspected or copied by this migration. The session partition name remains
`persist:remote-codex` to avoid changing its persisted identity.

## Host and local surfaces

`window.pockymoeHost` exists only on the configured **Web origin's top frame**.
Every call is checked in preload and again against the native sender/frame in
main. The Relay origin receives no page bridge. APNs alone targets Relay using
the Web window's authenticated session. Windows share that persistent session.
Local windows receive only sanitized activity and appearance snapshots.

`appearance.sync` updates effective light/dark, theme pack, resolved accent and
optional font scale. Local windows mirror Classic / Plum Pocket / Terminal
palettes, Windows tray variants and titlebar controls follow the effective mode,
and pet dependencies expose `appearance()` and `onAppearance()`. The shared
`statusMarks.ts` mirrors upstream shapes; running uses a complete faint track
with a rotating arc, waiting a filled speech bubble, interruption an amber
square and failure a red diamond. Quick-window rows are 44 px with live timers.
Activity snapshots preserve optional `rootThreadKey` / `rootThreadTitle`. Tray, quick
window and badges count conversations (`rootThreadKey ?? key`) per activity group;
agent members fold beneath the root title with their role, device and workspace.
Native notifications use the root conversation group and title while retaining
actual alert IDs. Replies, approvals and thread opening keep the selected member
key/threadId/requestId. The shared `activityGroups.ts` helpers also serve the pet.
Local DOM controls follow the approved Electron utility-window exception in
upstream `docs/ui-principles.md`, including keyboard/focus behavior, ErrorMark
feedback and custom overlay scrollbars.

ActivityHub owns connection baselines per device. A completed first device read
(`syncedDeviceIds`, including devices without threads) establishes its cutoff;
older items stay visible as history without emitting alerts or pet reactions.
For older pages without that metadata, the hub waits for two snapshots containing
the device. Missing items remain in the shared snapshot for 60 seconds, so a
short device/network gap does not resolve requests or change the pet's state.
Explicit state/request changes still resolve immediately. Recent-thread metadata
is validated and limited to five entries. `petEdgeHide` defaults to true and is
persisted alongside the other pet settings.

Notifications and tray items support **在地图中显示** (`revealInMap`). The tray and
Cmd/Ctrl+0 open the map (`openMap`). Cmd/Ctrl+K aliases the Web's existing
Cmd/Ctrl+F search binding; the shell does not register F a second time.

## UI language

The Web page is the language source: `appearance.sync` carries `locale` and all
open utility windows, tray/app menus and app-owned notifications follow it.
Before the first page sync, the shell resolves `app.getLocale()` to English or
Simplified Chinese. All app-owned desktop strings live in `src/shared/i18n.ts`;
status and agent labels use the same table. Language switches preserve input
values, the selected preferences section and quick-window selection. Existing
activity notices refresh with the same native alert ID. Native dialog titles and
app-supplied buttons use the current language; OS-owned file-picker chrome still
follows the operating system. User thread titles, summaries, names and external
diagnostics are content and are never machine-translated.

A `needsThread` result is preserved through main-process command handling. The
quick window keeps the reason next to an “Open in thread” action, targeting the
original thread. The local ErrorMark helper accepts an optional `actionLabel`
for the pet's matching action.

## Validation

```sh
pnpm typecheck
pnpm lint
pnpm test test/activity.test.ts test/delivery.test.ts test/security.test.ts test/store.test.ts test/discovery.test.ts test/appearance.test.ts test/nativeSurfaces.test.ts test/activityGroups.test.ts test/i18n.test.ts
pnpm build
pnpm exec playwright test test/shell.e2e.ts --project=electron
```

Fixtures use fresh temporary profiles, a Web server and a separate fake Relay,
and a whitelisted process environment. They never use production cookies or a
running Supervisor. The debug object exists only with `POCKYMOE_DESKTOP_E2E=1`.
Screenshots: `.local/desktop-evidence/shell/v2/` (three packs, light/dark, native
utility-window sizes plus 900/1440 width stress checks). The normal quick window
remains 640×420. Pet-specific checks belong to the pet module.

## Packaging, signing and packaged-app QA

The architecture comes from the CLI. `dist:mac` / `dist:win` intentionally request
both supported architectures; use a single flag for a focused local build.
Artifacts are named `Pockymoe-<version>-<os>-<arch>.<ext>`. Local outputs are under
`desktop/release/`, which is ignored by git. These commands never publish.

For a local Apple Development identity already present in Keychain (substitute
your own identity; no personal identity is committed):

```sh
pnpm build
export CSC_NAME='Apple Development: Your Name (TEAMID)'
pnpm exec electron-builder --mac --arm64 --dir --publish never \
  -c.mac.identity="$CSC_NAME" -c.mac.notarize=false
pnpm exec electron-builder --mac dmg zip --arm64 \
  --prepackaged release/mac-arm64/Pockymoe.app --publish never \
  -c.mac.identity="$CSC_NAME" -c.mac.notarize=false
codesign --verify --deep --strict --verbose=2 release/mac-arm64/Pockymoe.app
spctl -a -vv release/mac-arm64/Pockymoe.app
```

Hardened runtime remains enabled. `build/entitlements.mac.plist` grants Electron's
JIT/executable-memory requirements and deliberately has **no APNs entitlement**
or provisioning profile. APNs stays disabled unless explicitly configured for a
provisioned build. Notarization is explicitly off in these development commands;
Gatekeeper rejects this Apple Development build for distribution even when
`codesign` verifies it. Do not disable Gatekeeper or remove quarantine to turn a
QA build into a production release. Production signing/notarization needs its
own release configuration.

Run a local development-signed bundle directly for QA, without changing a running
Supervisor:

```sh
POCKYMOE_DESKTOP_WEB_ORIGIN=http://127.0.0.1:18894 \
POCKYMOE_DESKTOP_RELAY_ORIGIN=http://127.0.0.1:18890 \
release/mac-arm64/Pockymoe.app/Contents/MacOS/Pockymoe
```

The packaged Playwright driver uses the existing isolated fixture's private
`.local/e2e-desktop-env.json`, a fresh temporary application profile and the real
signed executable. It reads credentials only inside the sign-in flow; no auth
body, trace, storage state, credential log or authentication screenshot is saved.
It checks map home, tray/badge, bundled Moe asset hash, new approval notification
construction, quick shortcut callback, settings/session persistence and light/
dark screenshots. It never restarts the fixture or a Supervisor.

```sh
# From desktop/, with scripts/e2e-desktop-backend.sh already running:
node test/packaged-qa.mjs
# Or use a different signed bundle executable:
POCKYMOE_PACKAGED_EXECUTABLE=/absolute/Pockymoe.app/Contents/MacOS/Pockymoe \
  node test/packaged-qa.mjs
```

The automated shortcut assertion captures the callback while forwarding actual
`globalShortcut.register` to the OS, verifies registration, then invokes that
exact callback. For a separate physical-key check, set
`POCKYMOE_PACKAGED_NATIVE_KEY=1`: the driver pauses for the native
Control+Option+Shift+P chord. App-scoped CUA injection did not activate the global
hotkey in this environment, so physical HID delivery is not claimed by the
callback test. The temporary profile is removed on exit. Safe evidence goes to
`.local/desktop-evidence/shell/packaged/`.

### Windows build on a Windows runner

Windows x64 directory and NSIS builds also work on this Mac with electron-builder
26.18; no Wine/system installation was required. Windows execution, Mica, tray,
notifications and installer behavior still need a Windows machine. For a native
runner, the following GitHub Actions job is ready to adapt (not dispatched here):

```yaml
jobs:
  windows-desktop:
    runs-on: windows-2022
    defaults:
      run:
        working-directory: desktop
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
          cache-dependency-path: desktop/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm build
      - run: pnpm exec electron-builder --win nsis --x64 --publish never
      - uses: actions/upload-artifact@v4
        with:
          name: pockymoe-win-x64
          path: desktop/release/*.exe
```

Use a separate `--arm64` job for an ARM64 installer. Production Windows signing
credentials belong in the runner's secret/environment configuration, never in
the repository. `USE_SYSTEM_WINE=true` can prevent automatic Wine toolset
retrieval during a macOS cross-build; it was not needed by the successful native
resource/NSIS build steps here.

## Distribution and platform gates

```sh
pnpm dist:mac  # arm64 + x64 dmg + zip, --publish never
pnpm dist:win  # x64 + arm64 NSIS, --publish never
```

Updater: GitHub `dufangshi/pockymoe-app`; packaged apps ask before downloading
and restarting. Signing/notarization credentials belong to the release
environment. App artwork is the current upstream `public/pockymoe-icon.png`,
converted to ICNS/ICO; monochrome tray and count overlays are vector-derived.
Rebuild assets with Pillow: `python scripts/generate-icons.py` on macOS.

APNs requires packaged macOS, `POCKYMOE_DESKTOP_APNS=1`, and a provisioned
`aps-environment` entitlement (absent from development entitlements).
`POCKYMOE_DESKTOP_APNS_SANDBOX=1` sets the sandbox field. Registration posts
`nativePlatform`, `deviceToken`, `relayOrigin`, `sandbox` and
`appKind: 'macos-desktop'` to Relay `/relay/account/notifications/native`, with
credentials included via the main window's session; missing entitlement, auth
and network failures are quiet. Session changes retry registration without
inspecting cookies. Tokens are never logged.

Windows Mica/fallback, startup, toast actions, overlays and installers require
Windows validation. Notification Center/APNs and replacement of an APNs notice
with the matching local ID require a signed macOS build. Electron has no portable
public DND/Focus query: system notifications respect OS Focus, while the pet
currently uses focused-thread, idle and snooze signals. The packaged QA build is development-signed locally; no publish, release or
deployment is performed by these checks.
