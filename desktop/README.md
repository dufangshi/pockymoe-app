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
Local DOM controls follow the approved Electron utility-window exception in
upstream `docs/ui-principles.md`, including keyboard/focus behavior, ErrorMark
feedback and custom overlay scrollbars.

Notifications and tray items support **在地图中显示** (`revealInMap`). The tray and
Cmd/Ctrl+0 open the map (`openMap`). Cmd/Ctrl+K aliases the Web's existing
Cmd/Ctrl+F search binding; the shell does not register F a second time.

## Validation

```sh
pnpm typecheck
pnpm lint
pnpm test test/activity.test.ts test/delivery.test.ts test/security.test.ts test/store.test.ts test/discovery.test.ts test/appearance.test.ts test/nativeSurfaces.test.ts
pnpm build
pnpm exec playwright test test/shell.e2e.ts --project=electron
```

Fixtures use fresh temporary profiles, a Web server and a separate fake Relay,
and a whitelisted process environment. They never use production cookies or a
running Supervisor. The debug object exists only with `POCKYMOE_DESKTOP_E2E=1`.
Screenshots: `/tmp/rc-desktop/evidence/shell/v2/` (three packs, light/dark, native
utility-window sizes plus 900/1440 width stress checks). The normal quick window
remains 640×420. Pet-specific checks belong to the pet module.

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
currently uses focused-thread, idle and snooze signals. No publish, release,
installer signing or deployment is performed by these checks.
