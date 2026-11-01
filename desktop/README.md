# Remote Codex desktop

Standalone Electron 45 shell. The main window loads the relay; quick window,
preferences, relay setup and pet UI are local, sandboxed renderers. This package
has its own pnpm lockfile and does not use the mobile or control-plane build.

```sh
cd desktop
pnpm install
pnpm dev

# Connect to an isolated local relay (no production Supervisor restart needed):
RC_DESKTOP_RELAY_ORIGIN=http://127.0.0.1:5173 pnpm dev
```

`RC_DESKTOP_RELAY_ORIGIN` skips first-run origin setup. HTTPS is required outside
`localhost` / `127.0.0.1`. The default is `https://remote.lnz-study.com`. To use a
separate desktop profile, set `RC_DESKTOP_USER_DATA=/absolute/path`. The normal
profile stores settings, per-display window bounds, bounded notification IDs and
pet positions in Electron's user-data directory. Relay cookies/keys remain in a
separate persistent Electron session. Local windows receive summaries only.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test test/activity.test.ts test/delivery.test.ts test/security.test.ts test/store.test.ts
pnpm build
pnpm exec playwright test test/shell.e2e.ts --project=electron
```

The Electron fixture uses fresh temporary profiles, an ephemeral loopback relay,
and a whitelisted process environment. It never connects to a Supervisor. Its
screenshots are written to `/tmp/rc-desktop/evidence/shell/`. The debug inspection
object exists only with `RC_DESKTOP_E2E=1`. The pet engineer owns pet-specific tests.

## Packaging and updates

```sh
pnpm dist:mac   # arm64 + x64, dmg + zip; publish never
pnpm dist:win   # x64 + arm64, NSIS; publish never
```

Builds use `com.remotecodex.desktop`, product name **Remote Codex**, the existing
iOS cobalt terminal artwork, and original vector-derived tray icons. Rebuilding
the icons on macOS needs Pillow: `python scripts/generate-icons.py`. Signing and
notarization credentials are supplied by the release environment, never stored
in this package. macOS production builds require a Developer ID; Windows builds
require signing for a trusted installer. No signing, publishing or cross-platform
installer validation has been performed as part of this implementation.

`electron-updater` reads GitHub releases from `dufangshi/remote-codex-app`. Packaged
apps check on launch; the user chooses download and restart. Closing a window
keeps the shell resident; Cmd/Ctrl+Q exits. Notifications, tray, badges and pet all
consume one validated ActivityHub stream. Pending notices are coalesced after
1.5 seconds; acknowledged notices are removed across surfaces. Native notices
use Electron 45's `id` (macOS identifier / Windows toast tag). Windows approval
buttons use Electron's supported native `actions` API.

## APNs feature gate

APNs is disabled unless **macOS + packaged app + `RC_DESKTOP_APNS=1`**. The signed
build also needs an Apple-provisioned APNs entitlement (`aps-environment` matching
its provisioning profile); the default development entitlement file deliberately
contains no APNs environment. Use `RC_DESKTOP_APNS_SANDBOX=1` for an APNs sandbox
profile. Registration posts `nativePlatform`, `deviceToken`, `relayOrigin`,
`sandbox`, and `appKind: 'macos-desktop'` to
`/relay/account/notifications/native` through the relay window's authenticated
session. Missing entitlement/network/auth failures are quiet. Tokens are never
logged. APNs delivery and APNs/local replacement require a signed build to verify.

Electron has no portable public DND/Focus query. The policy accepts a DND signal
for future native adapters; system notifications currently respect the OS's own
Focus delivery, while the pet uses idle/focus/snooze signals. Windows Mica,
notifications/actions, taskbar overlays, login startup and installer behavior
still need validation on a Windows machine. macOS notifications need a signed
app for Notification Center delivery; unsigned E2E verifies policy decisions and
routing instead.
