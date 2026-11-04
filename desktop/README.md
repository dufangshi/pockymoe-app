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
There is no default Web or Relay address. `https://app.example.com` is an
example only. `POCKYMOE_DESKTOP_USER_DATA` selects an isolated app profile.
Setting both Web and Relay origins bypasses setup. HTTPS is required except on
loopback (`localhost`, `127.0.0.1`, `[::1]`).

## Install and use

macOS (Apple silicon): open the DMG and copy **Pockymoe.app** to Applications.
Windows: run the one-click NSIS installer (current user, no administrator prompt),
then open Pockymoe from the Start menu or desktop shortcut. Uninstall keeps user data. The development-signed macOS builds produced by the
QA command below are **not notarized** and are for local developer testing;
public builds use a dedicated non-personal self-signed identity and are not notarized; macOS may require explicit approval in Privacy & Security. Windows
builds without an Authenticode certificate are unsigned.

On first launch, enter your Pockymoe address, for example
`https://app.example.com`. The redirect probe discovers Web and Relay from that single field;
**Advanced** offers an optional Relay override. Sign in with your
existing account; this client does not install or replace a device Supervisor.

Use **Pockymoe → Preferences…** (Cmd/Ctrl+,) or the tray's Preferences entry to
change the connection, launch at login, alerts, pet and shortcut. In Pet settings,
Import… accepts a Codex pet folder or ZIP containing `pet.json` and its sprite
sheet. Show pet, size, mini mode and sound take effect immediately. Alt+Space
opens the quick window by default; choose another accelerator in Shortcuts if
that key is already used. Closing the main window keeps the app in the menu bar
or tray. Its Web activity source keeps running while hidden; native alerts and
the pet continue receiving changes. Cmd/Ctrl+Q or Quit Pockymoe exits.

## Connection discovery

First run asks for **Pockymoe 地址**, accepting a Web origin or Relay origin.
Discovery first probes the entered address and follows validated redirects without credentials:

- For separate static hosting, GitHub Pages `STATIC_HOSTING.txt` has `Relay API origin: <origin>`, emitted by
  `apps/supervisor-web/staticHosting.ts` from `VITE_POCKYMOE_RELAY_ORIGIN`.
- If the text asset is unavailable, the generated HTML meta CSP's `connect-src`
  supplies candidate Relay origins. Candidates must answer `/healthz` with
  `{ "status": "ok" }`.
- An API-only Relay's `/` redirects to its configured `POCKYMOE_WEB_ORIGIN`.
  The entered Relay is then health-checked separately. A same-origin Relay
  serving the UI resolves both fields to itself.

Discovery omits credentials, bounds downloads to 2 MB, times out individual
requests, validates every redirect and never executes returned HTML/scripts.
The response must identify Pockymoe. **高级** overrides the Relay while the
main field supplies the Web address (or a Relay redirecting to it). Invalid or
unreachable addresses remain on setup with one inline explanation, without
saving the pair or opening an offline window. An outage after connection opens
the local offline page with **Retry** and **Change address**; Change address
returns to setup with the current address filled in. Preferences displays the current pair and opens the same form for
changes. No new backend endpoint is required.

The app is `Pockymoe` (`com.pockymoe.desktop`); `pockymoe://` is the primary
protocol and `remotecodex://` is accepted for compatibility. Existing JSON
settings under the old `Remote Codex` user-data directory are copied once if no
Pockymoe settings exist. A v1 relay-only profile is probed once on upgrade; success persists the discovered
pair. Failure persists an empty Web origin and returns to setup with the saved
Relay filled in and an explanation, so it is not silently guessed or re-probed
on every launch. An existing explicit Web/Relay pair is preserved. Profiles without
a saved address open setup; explicitly saved origins are preserved. Credentials/keys are
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
palettes and Windows titlebar controls follow the effective mode; tray variants follow the system taskbar theme,
and pet dependencies expose `appearance()` and `onAppearance()`. The shared
`statusMarks.ts` mirrors upstream shapes; running uses a complete faint track
with a rotating arc, waiting a filled speech bubble, interruption an amber
square and failure a red diamond. Quick-window rows are 34 px with live timers, without group headings. The
560 px quick window fits one to seven rows, then scrolls; it shows recent threads
when there is no activity. Native HUD vibrancy/acrylic remains visible through
the transparent renderer.
Activity snapshots preserve optional `rootThreadKey` / `rootThreadTitle`. Tray, quick
window and badges count conversations (`rootThreadKey ?? key`) per activity group.
The quick window shows exactly one row per conversation across all activity states.
A small robot and count represent its active child threads; location context is
available on hover, instead of repeated device/workspace text. Search matches any
member while keeping its conversation/count intact. Replies and opening use the
most urgent actual member (waiting first, then failure, completion, running).
Native notifications use the root conversation group/title, deduplicated location
context and the same robot count, without an Agent/智能体 prefix; approvals retain
actual thread/request IDs. Tray menus continue to expose individual request actions.
Replies, approvals and opening keep the selected member key/threadId/requestId.
The shared `activityGroups.ts` helpers also serve the pet.
Local DOM controls follow the approved Electron utility-window exception in
upstream `docs/ui-principles.md`, including keyboard/focus behavior, ErrorMark
feedback and custom overlay scrollbars. Local forms use drawn switches and a
root-level DOM picker with arrows, Home/End, typeahead, Enter/Space, Escape and
focus restoration. A source guard prevents native selects throughout desktop renderer source.
Preferences uses compact divided rows; Pet includes atlas thumbnails, attribution,
license/source links and edge auto-hide. About includes bundled artwork credits.
Atlas files are served on demand through the local session's `pockymoe-pet:`
handler, never sent as full sprite data with every activity snapshot.

ActivityHub owns connection baselines per device. A completed first device read
(`syncedDeviceIds`, including devices without threads) establishes its cutoff;
older items stay visible as history without emitting alerts or pet reactions.
For older pages without that metadata, the hub waits for two snapshots containing
the device. Missing items remain in the shared snapshot for 60 seconds, so a
short device/network gap does not resolve requests or change the pet's state.
Explicit state/request changes still resolve immediately. Terminal status, unread
and completion timestamps can arrive separately; the hub rechecks a newly unread
result or a timestamp corrected past the device baseline, then stable IDs prevent
repeat alerts. Recent-thread metadata
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
pnpm test test/quickConversations.test.ts test/activityBaseline.test.ts test/nativeControls.test.ts test/petCatalog.test.ts test/activity.test.ts test/delivery.test.ts test/security.test.ts test/store.test.ts test/discovery.test.ts test/appearance.test.ts test/nativeSurfaces.test.ts test/activityGroups.test.ts test/i18n.test.ts
pnpm build
pnpm exec playwright test test/localPolish.e2e.ts --project=electron
pnpm exec playwright test test/shell.e2e.ts --project=electron --grep 'split origins bridge|agent conversations preserve targets \(classic light\)|one language across surfaces \(classic light\)'
```

Fixtures use fresh temporary profiles, a Web server and a separate fake Relay,
and a whitelisted process environment. They never use production cookies or a
running Supervisor. The debug object exists only with `POCKYMOE_DESKTOP_E2E=1`.
Set `POCKYMOE_DESKTOP_EVIDENCE` to choose the screenshot directory (otherwise
the suites use temporary directories). Captures cover three packs, light/dark,
native utility-window sizes and narrow/desktop width checks. The normal quick
window is 560 px wide and fits its contents. Pet-specific checks belong to the pet module.

## Packaging, signing and packaged-app QA

Public releases contain exactly three files:

- `Pockymoe-<version>-android.apk` (signed with the existing local Android key)
- `Pockymoe-<version>-mac-arm64.dmg` (Apple silicon only, dedicated non-personal Pockymoe signature)
- `Pockymoe-<version>-win-x64.exe` (x64 NSIS only)

No ZIP, combined installer, update manifests or blockmaps are published. Builder
targets and scripts pin these architectures; the packaging regression rejects
extra targets/architectures or an updater dependency. Local outputs are ignored.

From the repository root on the Apple silicon signing Mac, bump the desktop
version, Android `versionName` and Android `versionCode` in a reviewed commit.
The versionCode must exceed the latest release APK's value. Merge first, then
use a **clean `main` matching freshly fetched `origin/main`**:

```sh
scripts/release-client.sh 0.3.0
# Explicit separate publishing invocation, after reviewing the first output:
scripts/release-client.sh 0.3.0 --publish --notes-file /absolute/release-notes.md \
  --output .local/client-release/0.3.0-publish
```

Copy `desktop/release-notes-template.md` when preparing publication notes; it
includes the short macOS Keychain prompt notice.

`--publish` rebuilds and verifies before `gh release create --target <full SHA>
--latest --notes-file ...`. It never updates an existing release. Each invocation
requires an empty output folder and refuses extra files rather than deleting
anything. Default output is `.local/client-release/<version>` and contains only
the three named artifacts. Intermediate builds, extraction and smoke profiles
use a temporary directory. To verify an unmerged **clean candidate branch**,
`--validate` runs the same real build/scan/signature/startup gates, bypassing only
the main/origin check; it cannot be combined with `--publish`. Every unpublished
run, including normal builds on `main`, signs update metadata with a fresh
throwaway Ed25519 key held only in memory. It never reads the production metadata
private key. Validation notes and their public key are saved beside the output
folder, named `<output-folder>-validation-notes.md` and
`<output-folder>-validation-public-key.pem`, for independent verification:

```sh
node scripts/update-signatures.cjs verify 0.3.0 .local/client-release/0.3.0 \
  .local/client-release/0.3.0-validation-notes.md \
  .local/client-release/0.3.0-validation-public-key.pem
```

These validation signatures are rejected by production clients. Only explicit
`--publish`, from clean `main` matching freshly fetched `origin/main`, accesses
the production metadata key. The signing tool repeats that source gate.

The script builds the Mac app with hardened runtime off, then signs it using the
stable self-signed **Pockymoe** certificate in a dedicated local keychain. This
avoids publishing a developer's name/email and pins the leaf certificate for
update installation checks. `scripts/setup-client-signing.py` reuses that identity;
no system trust change or lasting keychain-search-list change is required. Builder
trusted-identity discovery cannot find this untrusted certificate, so the script
signs explicitly and packages the prebuilt app into the DMG. Gatekeeper warnings
on first install are expected. It briefly launches the built bundle with an
isolated empty profile and loads its packaged voice addon. All five Windows speech
files and PE headers are checked in the unpacked app and extracted NSIS payload.
The APK is built through `scripts/assemble-signed-apk.sh`; its certificate must
match the latest APK, and versionCode must increase. GitHub lookup failures stop
the build; absence of a previous APK is reported. Keys stay on this Mac, never CI.

Every artifact is scanned with `scripts/check-production-address.py`, including
the entire read-only mounted DMG volume root (including its hidden files and
artwork), extracted ASARs, NSIS app payload and expanded APK. The app inside the
final DMG must also pass the pinned leaf-certificate check.
The guard reads the hashed production fragment, local Git email/full name,
Keychain signing identities/emails, and optional newline-separated private values
from `POCKYMOE_PRIVATE_IDENTIFIERS_FILE`. Values stay in memory; only hit paths
are reported. Never put private values into arguments or tracked files.

Release metadata is signed with Ed25519 and appended to the notes in one
`<!-- pockymoe-updates-v1 ... -->` HTML comment. It binds each desktop artifact's
`version`, `platform`, `fileName`, `sha256` and `size`; no fourth asset is needed.
For publication, generated `<version>-release-notes.md` sits **beside** the output
folder. Unpublished runs write the validation notes/public key described above.
`--publish --notes-file FILE` rebuilds and signs current production metadata before creating
the release, so stale hashes from an earlier build are never reused.

The release script never touches `/Applications/Pockymoe.app`. A separate local
development-signed build/install is optional; do not distribute that identity.

For a local Apple Development identity already present in Keychain (substitute
your own identity; no personal identity is committed):

```sh
pnpm build
export CSC_NAME='Apple Development: Your Name (TEAMID)'
pnpm exec electron-builder --mac --arm64 --dir --publish never \
  -c.mac.identity="$CSC_NAME" -c.mac.notarize=false
pnpm exec electron-builder --mac dmg --arm64 \
  --prepackaged release/mac-arm64/Pockymoe.app --publish never \
  -c.mac.identity="$CSC_NAME" -c.mac.notarize=false
codesign --verify --deep --strict --verbose=2 release/mac-arm64/Pockymoe.app
spctl -a -vv release/mac-arm64/Pockymoe.app
```

For a separate local development-signed install, quit your existing client yourself,
then copy `release/mac-arm64/Pockymoe.app` into Applications in Finder. Packaging
and tests never perform that copy. Keep the development identity consistent for
local testing. Its identity differs from the public Pockymoe certificate, so the
update icon opens the release page instead of replacing this development copy.

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

### Alert integration QA

With the isolated fixture already running and the current signed macOS bundle
built, run `node test/packaged-alerts-qa.mjs`. Set
`POCKYMOE_PACKAGED_EXECUTABLE` to test another bundle executable. The driver signs
in with a fresh temporary profile, records actual hub events, pet state changes,
delivery decisions, native Notification construction and both dismissal paths.
It checks Dock visibility before/after close-to-tray and reopen, and confirms the
exact process is a foreground Pockymoe app in Launch Services.

The real authenticated backend fixture remains distinct from a supplemental
60-second, 250-item contract stress case (11 devices, 21 workspaces). The latter
checks historical silence and mood stability in the packaged main/pet processes.
Rendered control-bar buttons must cause no sprite-window bounds changes.
Idle time/proximity inputs are simulated inside the isolated test process;
Notification Center permission/display, physical clicks and OS shortcuts still
need the owner's observation. The test invokes the real native notification's
click handler and clicks the rendered pet bubble button. Neither is presented
as proof of an OS-delivered Notification Center click.

In the default Pet first mode, new completion/failure events use the pet while
the owner is active; system notices are added when idle for two minutes or the
pet is hidden. Explicit System or Both settings take precedence. Focused-thread
and snooze suppression still apply. Decision logs include event type because a
turn's started and completed/failed events intentionally share one alert ID.

For a focused event-matrix rerun, `POCKYMOE_PACKAGED_QA_PHASE=matrix` reuses
`packaged-alerts-history-proof.json` only if its 60-second history/geometry checks
passed and its `app.asar` SHA256 exactly matches the executable under test.
`POCKYMOE_PACKAGED_QA_CASE` can select one named case. Each report records this
scope explicitly; an unknown case or missing/mismatched proof fails. New app
artifacts require a full run.

### Windows build and acceptance

`.github/workflows/client-checks.yml` is the required client aggregate for pull
requests and the final merged SHA on main. It classifies the diff before starting product jobs: documentation and
version-only changes run the allowlist and address guard; desktop or pet changes
run one Windows lane with the relevant Playwright specification; updater/installer
changes run the real Windows NSIS A-to-B roundtrip; Android changes run Android
unit tests. The optional `full-ci` label or manual `workflow_dispatch` with
`validation=full` runs all four Windows scale/locale lanes and the complete Electron
suite. The old desktop/update/pet workflows remain manual-only for explicit full
validation. Evidence/logs are uploaded even on failure. There are no
signing credentials or publish/release steps.

From a fresh Windows clone, with Node 24 and pnpm 10 installed (PowerShell):

```powershell
cd desktop
pnpm install --frozen-lockfile
pnpm typecheck
pnpm vitest run
pnpm build
pnpm exec electron-builder --win --x64 --dir --publish never
$env:POCKYMOE_PACKAGED_EXECUTABLE = (Resolve-Path release/win-unpacked/Pockymoe.exe).Path
$env:POCKYMOE_DESKTOP_EVIDENCE = Join-Path (Get-Location) evidence/scale-1
$env:POCKYMOE_VOICE_DOWNLOAD = '1'
$env:POCKYMOE_DESKTOP_SCALE = '1'
pnpm exec playwright test --project=electron
$env:POCKYMOE_DESKTOP_SCALE = '1.5'
$env:POCKYMOE_DESKTOP_EVIDENCE = Join-Path (Get-Location) evidence/scale-1.5
pnpm exec playwright test --project=electron
```

The real voice-download test fetches the pinned 147 MB model from its public
GitHub release. No account, production backend or credentials are needed.

The surface test checks hidden native menus (including Alt), Ctrl labels,
scrollbar styling (including voice parameter textareas), local-window screenshots
and pet/glass screenshots. It also saves OS window thumbnails and bounds to
inspect native chrome when the runner exposes those windows. Main,
map and device images are **isolated Web contract fixtures**, not the separately
deployed Web UI. They verify the host surface and command routing; real Web-page
visual acceptance remains a separate Windows gate.

Cross-build Windows x64 on this Mac without running the Windows binaries:

```sh
pnpm build
pnpm exec electron-builder --win --x64 --dir --publish never
node scripts/verify-windows-package.cjs release/win-unpacked x64
```

pnpm installs only the Darwin arm64 and Windows x64 native speech packages.
`afterPack` keeps the target package and verifies the unpacked `.node` plus all four
DLLs, including each PE machine header. Windows runtime support checks these files
before offering local speech. Windows 11 build 22621+ requests Mica; older Windows
uses the selected theme's solid background. Windows tray icons follow the system
(taskbar) theme independently of the page theme. Only waiting conversations show
an amber speech-bubble taskbar overlay. Toast buttons use XML protocol activation
with in-memory, single-use tokens; approvals retain actual request IDs and don't
raise the main window. Custom Toast XML preserves the sound suppression policy.
Windows glass/quick panels use a 96% theme-background tint on Acrylic and an opaque
solid fallback, with normal/muted text tested to 4.5:1 over white and black backdrops.
Windows provides notifications only while the app runs. Update confirmations use
the themed local modal on Windows (Escape cancels, focus stays inside and returns
to the trigger); macOS retains its native dialogs. Confirmations are queued and
only their owning utility window can answer them. A fatal renderer/startup failure
still uses the OS error box because the local UI cannot run.

The [Windows design acceptance](../docs/desktop-windows.zh.md#8-验收) still needs
real-Windows checks of installer, full-screen overlays, taskbar placement, mixed
DPI and x64 execution. Cross-build checks do not prove the app runs on Windows.
Task-specific evidence and audit reports belong in ignored `.scratch/` directories.

## Distribution and platform gates

```sh
pnpm dist:mac  # arm64 DMG only, --publish never
pnpm dist:win  # x64 NSIS only, --publish never
```

### In-app updates

Packaged apps check the public GitHub Releases API at startup, every hour,
on window focus (if the last check was at least 15 minutes ago),
and on wake (at most once per hour), through Electron `net` with ETag and the system proxy. Checks remain
gated until a connection is configured. Rate limits/network failures stay quiet
and rate-limit responses defer all checks, including manual ones, across launches.
Backoff honors Retry-After and GitHub reset headers, otherwise grows from one hour
to 24 hours. Preview tags are never stable updates. Versions are
compared numerically. `0.2.0` has no updater: download the next release manually
once to enter this update path.

A newer release is downloaded silently to `userData/updates/`. Before showing the
rail icon, the client checks the compiled Ed25519 key's signature and the exact
version/platform/name/size/hash. It checks the cached file again before installing.
Interrupted files are never ready; old downloads are removed after verification.
Download/hash/free-space failures back off exponentially per version, persisted
across launches and capped at 24 hours. An installation needs at least three
times the artifact size in free space. At most three failed install attempts of
one version are allowed in a launch; restarting the client resets that limit.
There is no runtime environment override for a production feed or verification
key. Acceptance builds explicitly compile a separate fixture key and feed.
A missing or bad signature on a higher version shows only
**发现版本 {version}，但无法验证它的签名，不提供更新** with **好** on a manual
check. There is no release link, download offer or rail icon for that release.
Preferences reports **已是最新版本**, **正在下载**, **更新已就绪** or **暂时无法检查更新**.
The tray offers **重启以更新到 {version}** when ready.

The Web host contract adds `features.updates` and optional
`updates.state()/onChange()/install()`. The page can request only the verified
update, with no install arguments. The rail's accent circle appears after
verification. When the page has unsent composer drafts or unsaved documents,
it asks before requesting installation. Save or send them before continuing. Main closes
windows before teardown. If any refuses to unload, it cancels with
**有未保存的文件，已取消更新**, leaving the app running and the icon ready. Failed installs
retain the icon and expose ErrorMark retry/download actions. Older hosts and
plain browsers have no icon.

On macOS the current and staged app must both pass strict leaf-certificate
verification. A read-only DMG is copied to a temporary sibling; a detached helper
waits for exit, renames, launches the new app, then removes the backup. An early
launch failure restores and relaunches the old app, and reports the failure after
restart. Startup repairs an orphaned backup and removes stale staged siblings,
backups and installers for the running version. Non-writable, translocated,
disk-image or differently signed copies
(including a development-signed installation) open the release page instead.
Tests never replace `/Applications/Pockymoe.app`.

On Windows the verified x64 one-click per-user NSIS installer runs detached with
`/S --updated --force-run /D=<running executable directory>`; the final `/D=`
argument pins the install destination even with stale registry state. Windows
arguments are passed verbatim so NSIS receives the unquoted final directory even
when the path contains spaces. Relaunch
uses the installed executable directly, never a preserved Start-menu shortcut
that could target an older copy. `--updated` allows the old process to close gracefully
and `--force-run` relaunches even in silent mode. An attempt marker is written
before launching it; an old-version restart after an incomplete attempt shows
**上次更新没有完成** with retry/download actions. User data remains in place.
Electron `net` writes no Mark of the Web stream; CI tests genuine A→B installer
relaunch and preserved cookie/encrypted secret, while interactive SmartScreen
behavior still needs real-device observation.

**macOS Keychain prompt:** macOS may ask once after each update. Choose **Always
Allow** to keep sign-in and saved voice keys. If you deny access, sign in and enter
voice keys again; the client keeps secure Keychain storage and never substitutes
a mock Keychain or basic password store. Inaccessible voice keys stay encrypted
and are not repeatedly decrypted during that launch.

A stable self-signed identity does not establish an
Apple TeamIdentifier. In the real updater A→B test macOS attached a build-specific
`cdhash` partition ACL to the fixture Safe Storage item; B requested Keychain
access despite the unchanged leaf certificate/designated requirement. The signed-DMG
swap/relaunch succeeded, then B blocked in `SecItemCopyMatching`. No system
trust/ACL changes are made to hide this. A Keychain prompt or sign-in recovery may
be needed; seamless sign-in must not be assumed.

**Draft limitation:** Web composer drafts are currently an in-memory Map, including
File attachments. They survive route changes but **do not survive a full client
quit/relaunch**. The page names conversations with unsent text or attachments in the primary
**更新并重启？** confirmation, alongside unsaved-document counts. The tray follows
the same page flow. With nothing unsent or unsaved, updating is immediate; cancel to keep working or save/send them first. The updater
does not claim to preserve them. Agents continue running on their Supervisors.

### Key backup and rotation

Run `node scripts/update-signatures.cjs init` only for explicit initial provisioning
on the signing Mac. The production Ed25519 key is `client-update-ed25519.pem`
beside the Android keystore in the private mobile-release directory; only
`desktop/build/update-public-key.pem` is committed. Private key files remain
mode `0600`, as do the local release credentials. Back up these and the dedicated
Mac signing keychain/certificate/private key securely offline. Never upload them
to CI or a repository, or print their contents.

This separation prevents someone who only compromises the GitHub account or
release assets from forging an update that installed clients accept. File mode
`0600` restricts access by other local users; it does **not** protect keys from
code running as this Mac user, which can also access local signing and GitHub
credentials. The keys stay usable for unattended releases; they are not a
sandbox for unreviewed code running under this account. Validation uses a fresh
throwaway Ed25519 metadata key and cannot produce production-trusted release
notes. The stable Mac code-signing certificate is a separate key: validation
still uses that certificate so the installed app's leaf pin can be tested.

The current updater trusts one metadata public key and one Mac certificate pin;
there is no automatic rotation protocol. Replacing either directly requires
people to download/install the new client manually once. Seamless planned
rotation first needs a reviewed client change that accepts both old and next
keys/pins, delivered in an old-key-signed release while the old Mac identity still
matches. Only after that transition is installed can a subsequent release switch
to the new keys. Keep the old signing keys while older clients need a bridge.
If a private key is lost, or a trust root must be revoked without that transition,
existing clients cannot safely self-update. Tell users through a separately
trusted channel to download/install manually once; the app never offers a link
from an unsigned or invalidly signed release.

App artwork is the current upstream `public/pockymoe-icon.png`,
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

### Real Windows Web acceptance

The real main/conversation, map and devices captures are independent tests in
`test/realWeb.e2e.ts`. Enable `POCKYMOE_REAL_WEB=1` after starting the isolated
v0.13.44 runtime plus pinned public-source Web fixture using the fresh-clone PowerShell instructions in
[scripts/desktop-fixture/README.md](../scripts/desktop-fixture/README.md#windows--pinned-public-sources-and-release-runtime).
They sign into the disposable account and choose themes through the real Web
Settings. They do not use placeholder pages, injected theme CSS or production.
The Windows CI starts/stops that fixture and runs English/Chinese locale
assumptions, plus native and solid local surface matrices. Optional voice/clip
cases skip before launching Electron, so a missing input does not leave an
unready app for teardown. Windows shortcuts use native SendKeys after focusing and verifying the exact
main-window HWND (process activation can choose the pet instead); Mac tests invoke the built menu command without requiring OS automation
permissions. The separate menu test includes Electron's role default accelerators.

Quit marks the window manager as quitting before other cleanup and ignores later
activation events, so an activation cannot reopen a background window during
shutdown. `shutdown.e2e.ts` covers that ordering. Readiness failures report only
window/runtime state and URL paths, never environment values or Web contents.
Real conversation captures additionally wait for seeded transcript content (not
just the route change) and dismiss the first-use tour through its normal button.
This prevents a loading surface being mistaken for conversation acceptance.
The pet cancels its native-window polling on `before-quit` and ignores already
destroyed sprite/glass windows. This prevents a timer from raising an uncaught
native-object error while Electron is closing the app. On Windows, empty quick-window reply
placeholders also refresh when the interface language changes.

The real-Web audit distinguishes unstyled native scrollbars from the release
Web's shared theme-painted WebKit thumbs (explicit size/color and no arrows).
An Electron regression demonstrates that the audit rejects a default scrollbar
and a Mac modifier label while accepting that fully styled scrollbar form.

Map captures move the pointer off content and wait for hover cards to close.
Device captures wait for the seeded model-usage row, so an initial empty loading
state is not presented as the final devices page.

Windows main-window caption colours resolve the configured page's actual
`--matter-chrome`, `--theme-bg` and `--theme-fg` tokens after load/theme changes.
Only flat validated RGB colours reach the native API; utility windows retain
their local palettes, and Mac behaviour is unchanged. Failed page reads keep
the existing fallback. Native captures precede Web audit assertions.

Pet state delivery rechecks native liveness after IPC and retires polling when
either native pet window closes. Only Electron's exact destroyed-object error
is treated as a retired handle; other exceptions still fail. The quit regression
destroys glass during state delivery, after the entry guard, to cover reentrancy.
Windows key automation temporarily joins input queues when required to focus
the exact HWND, detaches them immediately, and verifies the target before typing.

Native pet close requests preserve the controller: closing the glass dismisses
its current panel, while closing the sprite writes the same hidden setting as
Hide Pet. Forced destruction retires both windows and reports the pet unavailable.
An empty panel omits the reply row on both platforms (design v3 §2.3).
Unknown/stale Windows Toast activation tokens focus the main window without
executing an approval or rejection. Model extraction cancellation kills tar and
waits for its close before removing files; Windows file-lock retries are bounded.
The voice fixtures use a Chinese path containing a space.

Windows CI uploads six-theme contact sheets under
`scale-<scale>/contact-sheets/{main,map,devices,preferences,quick,glass}.png`, along
with the full original PNGs. Fixture tunnel deadlines start when that phase begins,
so browser bootstrap time cannot exhaust a device's connection budget.

Closing a main window before its first ready-to-show event suppresses that initial
show, so loading cannot bring a backgrounded window back to the foreground.

On Windows the speech utility process selects the model directory through Node's
Unicode cwd API and passes relative filenames to sherpa's native readers.
Forced pet destruction retires its survivor after the native close stack unwinds,
so an owner cannot reenter destruction of its child on Windows.

Tray disposal removes pending window-ready callbacks and subscriptions; later
window readiness or theme/activity changes cannot update a destroyed native tray.
The shutdown regression delivers that late event after disposal before quitting.

### Address setup and public-source guard

There is no default Web or Relay address. A fresh profile, or an older
`settings.json` without an address, opens the existing connection page with an
empty input and `https://app.example.com` as its placeholder. The page explains
that a default address is no longer provided. Saving a connection completes
setup; later launches keep the stored origins (including previously explicit
production origins). A legacy relay-only profile goes through the credential-free redirect probe once;
an existing origin pair is preserved. Settings remain in Electron's user-data `settings.json`; no credentials
are migrated or inspected.

Until a connection is configured, Web/sign-in windows redirect to local setup,
automatic/manual update checks are deferred, and voice downloads/actions are
blocked. Setup itself loads bundled assets and contacts the entered address only
when Connect is pressed.

`python ../scripts/check-production-address.py` scans all tracked files using a
hash of the forbidden address fragment, reporting paths only. The Windows CI
also extracts `app.asar` with `scripts/extract-asar.cjs` and the builder's locked asar library and scans the
contents, unpacked native files and renderer/main output. Mobile sources are
included in the source guard and must be cleaned by their respective owners.

### Built-in pet

MOE (`moe`) is the only bundled pet and the default. Other pets are user imports.
Old built-in selections `frost` and `gpt-dragon` fall back to `moe`. Imported ids
are retained, including an imported `frost` on later launches; only `moe` is
reserved against import. The package hook verifies that `resources/pets` contains
exactly `moe`. The procedural placeholder lives only in test fixtures.

### Electron lifecycle regressions

Local renderers subscribe before requesting their initial state, buffer broadcasts
while IPC is in flight, and select the newest revision before mounting. This
prevents an empty quick list from losing a newer activity snapshot during startup.
E2E window readiness follows actual renderer/navigation events and then waits for
DOMContentLoaded; it does not treat a five-second cold-load delay as a missing
window. Activity fixtures acknowledge fire-and-forget updates with a same-frame
IPC round trip before acting in another window. Hover stability checks pin the
pointer input and await the renderer/native size acknowledgement before measuring,
so host pointer movement and unfinished initial layout cannot change the premise.

Windows tray updates stop as soon as the window manager enters quitting, before
native tray disposal. Image/menu preparation can reenter native ready/quit events,
so updates recheck liveness before touching the tray. The shutdown regression
retires the native tray during image preparation and delivers a late window-ready
callback before disposal; the app must still exit cleanly.
