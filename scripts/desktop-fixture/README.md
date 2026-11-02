# Pockymoe desktop backend fixture

```sh
./scripts/e2e-desktop-backend.sh start              # API relay + static Web + 3 devices
./scripts/e2e-desktop-backend.sh serve --dev-web    # Vite instead; foreground cleanup
./scripts/e2e-desktop-backend.sh status
./scripts/e2e-desktop-backend.sh rebuild-web        # fresh Pages build; atomic swap
./scripts/e2e-desktop-backend.sh env                # PRIVATE local test credentials
./scripts/e2e-desktop-backend.sh stop-device 3
./scripts/e2e-desktop-backend.sh start-device 3
./scripts/e2e-desktop-backend.sh start-turn 1 THREAD_ID
./scripts/e2e-desktop-backend.sh request-approval 1 THREAD_ID
./scripts/e2e-desktop-backend.sh request-input 1 THREAD_ID
./scripts/e2e-desktop-backend.sh complete 1 THREAD_ID
./scripts/e2e-desktop-backend.sh fail 1 THREAD_ID
./scripts/e2e-desktop-backend.sh burst 18
./scripts/e2e-desktop-backend.sh verify              # API/WS + real browser
./scripts/e2e-desktop-backend.sh verify-api          # API/WS only
./scripts/e2e-desktop-backend.sh verify-browser      # Chromium only
python3 scripts/desktop-fixture/verify_lifecycle.py
./scripts/e2e-desktop-backend.sh stop               # retains logs and data
```

Run from any directory. Prerequisites: Python 3.9+, Node 20+, pnpm, Chromium from
Playwright, and the existing current debug binary. Default sources/binary:
`target/debug/pockymoe` of the Pockymoe checkout. No Rust build,
release, deployment or production supervisor update happens here.

Defaults: API-only relay `127.0.0.1:18890`, supervisors `18891..18893`, separate
Web `18894`. Configure `DESKTOP_E2E_POCKYMOE_ROOT` (`DESKTOP_E2E_CODEX_ROOT` is
still accepted), `DESKTOP_E2E_BIN`, `DESKTOP_E2E_RELAY_PORT`,
`DESKTOP_E2E_SUPERVISOR_PORT`, `DESKTOP_E2E_WEB_PORT` and/or
`DESKTOP_E2E_WEB_DIST`. Existing listeners cause an error. Port 45679 is forbidden;
the parent's preview at 18900/18901 is never used. Every child drops inherited
`POCKYMOE_*`, `REMOTE_CODEX_*` and legacy database/workspace/port settings, then
gets explicit fresh fixture paths and `POCKYMOE_E2E_FAKE_RUNTIME=1`.

## Production topology

`webOrigin` and `relayOrigin` differ, as on GitHub Pages. Static mode uses the same
`build:static`/Vite static mode as `.github/workflows/pages-deploy.yml`, with
`VITE_POCKYMOE_RELAY_ORIGIN` set to the isolated relay. It retains the generated
CSP, worker, themes, 404 fallback and other Pages artifacts. An isolated `--outDir`
under the app's `.local/e2e-desktop-web/` avoids overwriting another engineer's
`apps/supervisor-web/dist`. Builds are cached by source revisions/diff and origin.
A first build adds preparation time; subsequent starts reuse the artifact. An
explicit `DESKTOP_E2E_WEB_DIST` must already be a static build for this relay.

`static_server.py` binds only to loopback and serves files plus an extensionless
SPA fallback, with no API proxy. The relay gets `POCKYMOE_WEB_ORIGIN` for the
trusted Web origin, enabling its normal credentialed CORS/CSRF rules. It is
API-only and redirects document navigation to that Web origin. `--dev-web` instead
runs the product Vite config with the same relay origin. The fixture sets
`Service-Worker-Allowed: /` for its development worker and excludes test-only files
from HMR so a peer adding tests does not reset sign-in forms. Stop before changing
Web mode. `rebuild-web` compiles the current Web worktree into a fresh temporary
directory using this fixture's relay origin, then atomically exchanges the complete
served artifact directory. It changes no origin, account, relay, supervisor or Web
server process. Old hashed chunks are retained for lazy imports in already-open
pages; the previous full artifact is kept in the run's Web directory. A failed
build leaves the served artifact intact. Output contains only the served path and
duration in seconds. Reload the page after success. Atomic exchange requires macOS
or Linux with `renameat2`; externally supplied artifacts outside the fixture's own
build directory are protected from replacement. `--dev-web` follows source edits
immediately.

The disposable `desktop` account is registered through the real Web UI: vault
creation, Argon2id, recovery confirmation and browser certification all run in
Chromium. The fixture does not bypass account security or inject a legacy account.
`.local/e2e-desktop-env.json` (0600) contains `webOrigin`, `relayOrigin`, local test
credentials, device IDs, workspace/thread IDs and named scenarios. `env` prints
that private file for test consumers. Never paste it into reports. Provisioning
tokens stay in separate mode-0600 files. Browser tests retain no trace, storage
state, recovery code, token, auth body or unmasked auth screenshot in evidence.

## Dataset and controls

MacBook Pro, Studio Linux and Build Box each have 81 threads in six workspaces:
60 roots plus 1–6 delegates under one root per workspace, closed delegates and
depth-three lineage. Titles mix Chinese/English and include very long examples;
providers include Codex, Claude and ACP. There are pinned threads, workspace
shortcuts, held running turns, pending approvals/questions, recent failed turns,
and completed-unread candidates. Named scenarios live in each device's `scenarios`.
`burst` excludes them and accepts 1–66 distinct threads across online devices.

Public HTTP through the relay creates accounts, devices, workspaces, shortcuts,
threads and lineage. The timestamp/import API cannot set historical turn records,
pin/closed flags or delegate names. Only the three recorded fixture supervisors
are stopped before `seed.py` transactionally backfills their fresh SQLite files.
It registers upstream's deterministic `search_fold`/`search_body` helpers so the
existing search triggers remain active; fixture history is plain supervisor prose.
No live SQLite writes, migrations or production data are involved.

Thread update times span 60 days. Each thread has 1–17 historical turns with varied
4-minute to 4.5-hour durations and tokens/pricing; recent turns spread through the
last 24 hours, older turns through the historical window. `thread-activity` thus
has varied turn counts, hourly bars and heat levels rather than equal blank tiles.
Two workspaces per device remain wholly older than 14 days and unpinned. Completed
history becomes unread according to the desktop index's per-browser viewed times.

Live events call the owner-only fake-mode `POST /api/e2e/events` with
`{type: "start"|"complete"|"fail"|"approval"|"input", threadId, text?}`. Real durable
turns/requests and ordinary bus events are used. Normal approval/answer APIs resolve
the requests. A missing hook fails startup and cleans up the partial run. Restart
uses the public resume API to settle `recovering` threads before restoring scenarios.
Start is idempotent and preserves intentional offline devices; stop/serve cleanup
checks PID birth times and stops only the fixture's owned process session groups.

## Focused verification

```sh
bash -n scripts/e2e-desktop-backend.sh
python3 -m py_compile scripts/desktop-fixture/*.py
node --check scripts/desktop-fixture/browser.mjs
python3 -m unittest discover -s scripts/desktop-fixture -p 'test_*.py'
./scripts/e2e-desktop-backend.sh verify
python3 scripts/desktop-fixture/verify_lifecycle.py
```

`verify-api` checks account session, separate static SPA fallback, each device's
81-thread/six-workspace collection, lineage/pins/shortcuts, realistic activity,
pending requests, all event types through all device `/ws` connections, and an
18-completion burst within one second. `verify-browser` runs only headless
`desktop-chromium`: real sign-in on `webOrigin`, all three devices on the map,
nonzero heat, visible start/completion/failure/approval/input changes in the selected
conversation, and successful encrypted device responses through the cross-origin
transport. Completion assertions use unique text rather than matching seed history.
It records a settled map screenshot and safe geometry facts. No product UI is added
or restyled by this task; theme/layout acceptance belongs to the desktop UI engineer.

Evidence: `.local/desktop-evidence/fixture/` (dev-mode browser evidence in `dev/`).
Logs remain under each run's `.local/e2e-desktop.*/relay`, `web`, `device-1..3`.

## Windows / pinned public release

The Bash wrapper is optional: run `python scripts/desktop-fixture/backend.py` with
identical commands in PowerShell. Windows lifecycle tracking uses PID + creation
FILETIME; cleanup only terminates a recorded matching process tree. Lifecycle
commands use a file lock. No installed Supervisor is discovered or controlled.
`rebuild-web`'s atomic directory exchange remains Mac/Linux-only.

From a fresh app clone (Node 24, pnpm 10, Python 3.9+):

```powershell
cd desktop
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
cd ..
python scripts/desktop-fixture/prepare-release.py
$runtime = Join-Path (Get-Location) .local/desktop-runtime-v0.13.44
$env:DESKTOP_E2E_BIN = Join-Path $runtime remote-codex-win32-x64-msvc-cli.exe
$env:DESKTOP_E2E_WEB_DIST = Join-Path $runtime web
$env:DESKTOP_E2E_RELEASE_WEB = '1'
python scripts/desktop-fixture/backend.py start
cd desktop
$env:POCKYMOE_REAL_WEB = '1'
pnpm exec playwright test test/realWeb.e2e.ts --project=electron
cd ..
python scripts/desktop-fixture/backend.py stop
```

The preparation downloads only v0.13.44 public release assets and checks each
against its SHA256SUMS. The release zip is unmodified runtime Web, not a Pages
build with a compiled cross-origin relay URL. `DESKTOP_E2E_RELEASE_WEB=1` therefore
uses the release runtime's real `POCKYMOE_RELAY_WEB_DIST_DIR` hosting, with Web and
API on the isolated relay port. It still creates three isolated supervisors,
real local account/vault, seeded histories, approvals and running threads.
The default Mac separate-origin mode remains unchanged. Existing split-origin
Electron tests independently cover the host bridge's origin isolation.
Credentials in `.local/e2e-desktop-env.json` are private test inputs: do not print
that file, trace authentication or include raw auth errors in reports.

`verify-api` accepts the explicitly selected release same-origin topology while
retaining the separate-origin assertion for Pages mode. On Windows the atomic
Web rebuild test is skipped because that operation is unsupported; startup and
PID/creation-time cleanup are still exercised. The safety suite creates and
terminates only its own recorded disposable Python child.
