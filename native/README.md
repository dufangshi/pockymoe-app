# Pockymoe native client

Native Android and iOS client (Expo SDK 58, React Native 0.88, TypeScript). Design and
layering: [ARCHITECTURE.md](ARCHITECTURE.md). Its app id is `com.pockymoe.app`; it
installs beside the WebView shell (`com.remotecodex.app`).

## What it does

- Connects through a relay account (end-to-end encrypted owner transport, account key,
  password or recovery code, second factor) or directly to a Supervisor URL (optional passcode).
- Devices with connection and protection marks; workspaces and threads with status marks,
  search (titles and messages), starred and recent threads; new thread as the Web's form
  (optional first prompt, backend, workspace, model and effort, title), and
  optionally its own worktree (name from the prompt, branch, base; a failed repository setup
  keeps the thread and opens it with the prompt as its draft).
- Thread: live transcript drawn as the Web phone draws it (turn head with time, cost, model
  and speed; work line with operation counts and ±files; prompt bubbles with attachment tiles;
  agent switch dividers; markdown, code, lazy command output, answers folding at 1200
  characters, failure marks), approvals and
  questions (Approve/Deny for permission requests without questions), stop, queue (send
  after this turn) and steer now, composer with photos, camera, files, quotes, and context use
  with Compact. The model picker is the Web's: an agent rail, search across agents, context and
  price per model from the device's catalog, an effort slider, and switching to another agent with
  a handoff note, a readable preview and Stop and switch while a turn runs (a bottom sheet on
  phones, a popover above the model key on wide windows). Prompts show their photos
  as thumbnails and their files as path chips; any image opens full screen (zoom, share);
  long prompts fold like the Web's. The open thread taps and reads out new requests.
- Git inspector (the Web's Git panel, `docs/git.md` in the runtime repo): Turn, PR, Unstaged,
  Staged, Compare and Commits views; stage, unstage and discard files and hunks; commit with a
  generated message, amend, and push after; branches, fetch, pull modes, push (upstream,
  force-with-lease) and stashes; conflicts handed to the agent; turn restore before or after
  with a preview and Undo; Edit from here (long-press a prompt) with files too.
- Diffs: unified or split (≥ 720 dp), wrap or one shared sideways scroll, find, folding,
  whitespace, colour-blind colours. Tap or long-press lines to comment: a review chip in the
  composer (`<pockymoe-quotes>` with path and lines), a PR draft, or a question for an agent.
- Pull requests (`docs/source-control.md`): the device's PR page (search qualifiers, filter
  pills, saved views), review with Conversation, Code (drafts, viewed files), Commits, Checks
  and Guide, submit, merge with agent credits removed, head guard, linked PRs and New PR in
  the Git pane, and stacks (layer bar, merge or rebase the stack). Phones push the review;
  wide windows show list and review side by side.
- Files: browse with a folder filter, read with numbered lines, find and line comments,
  rendered Markdown, images, large files in pages, copy and share.
- Notifications: the turn bell and the account's scope (subscribed, all, or selected devices,
  chosen in Settings) from the relay, iOS APNs registration
  through the relay, local notices for turns that finish, fail or wait while the app runs,
  and on Android a background watch service on the relay's account feed (as the WebView
  shell) whose notices name the thread and device and open it. Signing out stops the watch,
  erases its sealed token and clears posted notices.
- Phones: pushed pages; the Web's fused composer and dock (thread pill, Chat | Files, More),
  the composer one row at rest and two when focused. Tablets, foldables and
  landscape: list, thread and inspector columns; a vertical hinge places the column edge.
- Hardware keyboards: Ctrl/Cmd + Enter sends, N new thread, K search, [ back, Shift+G Git,
  Shift+E files. In the model picker, ↑/↓/Home/End move over the models, Enter picks, ←/→
  change agents; Enter in its search picks the first match.
- Classic, Plum Pocket and Terminal in light and dark mode; English and Chinese.

## Develop

```sh
npm install
npm run typecheck && npm test        # vendored protocol vectors, unit tests
npm run vendor:check                 # vendored files match SOURCE.json
```

Android on Linux (JDK 17 and the command-line SDK, no Android Studio, no EAS):

```sh
export JAVA_HOME=<JDK 17> ANDROID_HOME=<Android SDK>    # and their bin dirs on PATH
npm run android:prebuild                         # generates android/ (not committed)
(cd android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64)
npx expo start --port 19210 --localhost          # Metro for the debug build
adb reverse tcp:8081 tcp:19210
```

A debug build looks for Metro at `10.0.2.2:8081`; with `adb reverse`, set the app's
`debug_http_host` preference to `localhost:8081` once (dev menu → Settings, or write
`shared_prefs/com.pockymoe.app.dev_preferences.xml`).

`npm run android:release` builds a standalone APK with the bundle inside (debug-signed).

Variants (`APP_VARIANT` when running prebuild):

| `APP_VARIANT` | App id / bundle id | Name | URL scheme |
| --- | --- | --- | --- |
| (unset) | `com.pockymoe.app.dev` | Pockymoe Dev | `pockymoe-app-dev` |
| `preview` | `com.pockymoe.app.preview` | Pockymoe Preview | `pockymoe-app-preview` |
| `production` | `com.pockymoe.app` | Pockymoe | `pockymoe-app` |

The WebView shell is `com.remotecodex.app` and owns `pockymoe://` (its relay sign-in
callback), so the native schemes stay apart. Notification channels (`threads`,
`pockymoe-watch`) belong to each app id. Release signing is not wired here yet: the shell
signs with its own keystore (`REMOTE_CODEX_ANDROID_*`, alias `remote-codex-release`); the
native app should get its own upload key (suggested alias `pockymoe-app-release`), since a
new app id starts a new Play listing. iOS push needs the relay's APNs topic for
`com.pockymoe.app` (the relay has one topic per app kind, `POCKYMOE_APNS_TOPIC` is the shell's).

iOS without a Mac: `.github/workflows/native-ios.yml` (GitHub Actions `macos-26`, newest Xcode;
Expo SDK 58 needs Xcode 26.4 or later) runs on pushes to `feat/native-mobile` under `native/`
on pull requests to `main` and on demand. It generates the project (`expo prebuild --platform ios`),
builds Debug and Release for the iOS Simulator, plus the free-Apple-ID variant (simulator, launch,
and an unsigned device build that proves device compilation), signed ad hoc by Xcode with the simulator keychain entitlements
(`scripts/ci/simulator.entitlements`, embedded as simulated entitlements; without them the
Keychain refuses every call), and checks that the Release app launches and stays up. The .app
files are the run's artifacts; screens are tested on the x86sim lab with them. `.maestro/screens.yaml` walks the main screens
(`maestro test -e OUT=… -e URL=http://localhost:<port> .maestro/screens.yaml`) against a
Supervisor seeded by `scripts/ci/seed-local.mjs`.

iOS needs a Mac: `npm run ios:prebuild`, then `pod install` and build `ios/PockymoeDev.xcworkspace`
(`ios/Pockymoe.xcworkspace` for `APP_VARIANT=production`). Without an Apple Developer Program
membership, install on your own iPhone with a free Apple ID: [docs/ios-install-personal.md](docs/ios-install-personal.md)
(`scripts/ios-device-install.sh`, `POCKYMOE_IOS_SIGNING=personal`: no push, Live Activity without
push updates). `POCKYMOE_IOS_BUNDLE_ID` and `POCKYMOE_IOS_TEAM_ID` override the bundle id and team.

Versions follow the WebView client: `app.config.ts` reads `versionName`/`versionCode` from
`../android/app/build.gradle.kts`, which the client release checks against the release version.
Android release builds are signed with the client release keystore when its environment is set
(`plugins/withReleaseSigning.js`: `REMOTE_CODEX_ANDROID_*` as the client release passes them, or the
`CLIENT_ANDROID_*` secrets); otherwise with React Native's debug key.

## Lab backend

`scripts/lab/lab.sh` starts an isolated relay (registration on), relay devices with the
fake runtime and a direct local Supervisor, each with its own HOME under `env -i`:

```sh
export LAB=<scratch dir> BIN=<pockymoe binary> WEB_DIST=<supervisor-web dist>
scripts/lab/lab.sh start && scripts/lab/lab.sh local 19203
LAB=$LAB npx vitest run --config vitest.lab.config.mts   # register, add devices, seed threads
adb reverse tcp:19201 tcp:19201                          # the emulator reaches the relay as localhost
```

`test/lab/fixture.lab.test.ts` sends approvals, questions and held turns to a lab thread
(`FIXTURE=approval|input|complete THREAD=<id>`); `test/lab/attachments.lab.test.ts` sends a photo
and a file the way the composer does, `test/lab/api.lab.test.ts` drives every `DeviceApi` call the
screens make on a thread it creates and deletes (`DIRECT=http://localhost:19203` for the direct Supervisor), and checks the stored paths and image bytes
(`THREAD=<idle thread>`). `test/lab/worktree.lab.test.ts` creates threads in new worktrees on a
direct Supervisor that has `POST /api/threads/start-worktree` (`DIRECT=<url> LAB=<dir>`; it makes
its git repositories under `LAB/local/ws`). Never point the lab at a real relay.

## Vendored protocol code

`vendor/pockymoe/` is copied verbatim from the runtime and shared UI repositories by
`scripts/sync-vendor.mjs <runtime> <thread-ui>`, which writes `SOURCE.json` (commit and
SHA-256 per file). Browser-only dependencies are replaced without editing those files:
overlays in `vendor-overlay/` (new files only) and aliases in `resolver.cjs`. Theme tokens
come from the Web's CSS through `scripts/gen-tokens.mjs`.
