# Pockymoe native client: architecture

`native/` is a native Android and iOS client for Pockymoe, written in TypeScript with Expo and
React Native, with its own Kotlin and Swift modules where React Native falls short. It does
not use a WebView for the product UI (`expo` itself links `@expo/dom-webview` for its
development error overlay; no screen uses it). It sits beside the WebView shells in `android/` and
`ios/`, which it does not change, and installs beside them as `com.pockymoe.app`
(`.dev` and `.preview` for development and preview builds).

It follows the way T3 Code builds its mobile app (`apps/mobile`, internals 09–13) and keeps
Pockymoe's own look: the three theme presets, agent avatars, the terminal-timeline transcript,
the composer and the one-hand dock.

## Layers

Each layer makes one decision. A feature screen never asks which platform or window width it
is on.

1. **Router** (`src/navigation/`). One root native stack is the layout state: what is selected,
   what is pushed, which sheet is open. Every route declares what it is with a preset
   (`pageRoute`, `sheetRoute`, `modalRoute`) that owns detents, corner radius, header and the
   Android fallback. Rotating, folding or resizing renders the same stack differently.
2. **Workspace shell** (`src/layout/`). Placement and widths from the width class
   (`useLayout()`):
   - *compact* (< 600 dp): the list is the root and pages push over it; the inspector is a
     sheet; the thread has the one-hand dock.
   - *medium* (600–899 dp): list and page side by side; the inspector is a sheet.
   - *expanded* (≥ 900 dp): list, page and inspector columns (Files, Git, Changes).
   Foldables: a vertical hinge splits columns at the hinge (`modules/pockymoe-native`
   reports the fold through Jetpack WindowManager).
3. **Feature screens** (`src/features/`). A screen places content by role: one `AppBar`
   (or `SheetHeader`), its page, and inspector panes declared with `useInspector()`. The shell
   decides column or sheet. Choosing a route, component or inset by width here is a bug.
4. **Design system** (`src/design/`). Tokens per preset and mode, primitives with one look
   each (`AppBar`, `Sheet`, `Button`, `IconButton`, `ListRow`, `StatusMark`, `CopyButton`,
   `PathChip`, `MiddleName`, `ConfirmDialog`, `Menu`, `Toast`), agent avatars, icons and
   haptics. Platform chrome branches only here (`.android.tsx` / `.ios.tsx`).
5. **Native** (`modules/pockymoe-native`, Expo modules API). Kotlin and Swift for what RN
   lacks: fold posture and hinge bounds (Jetpack WindowManager), and on Android the
   background thread watch: a `dataSync` foreground service (`ThreadWatchService`) that polls
   the relay's account feed `/relay/account/workbench`, as the WebView shell's
   `AgentEventService` does, and posts a notice that opens `<scheme>://thread/<device>/<thread>`.
   The session token and the thread titles it shows are sealed with an Android Keystore key;
   the feed itself carries only generic outcomes. iOS uses APNs through the relay instead, so
   the Swift side of the watch is a no-op. `PockymoeKeyCommands` is a view around the app for
   hardware-keyboard shortcuts (Ctrl/Cmd + Enter send, N new thread, K/F search, [ back,
   Shift+G Git, Shift+E files): on Android it wraps the window callback, because with nothing
   focused keys reach no view; on iOS it offers UIKeyCommands to the responder chain. Screens
   register handlers with `useKeyCommand` (src/platform/keyCommands.tsx). Plain arrows, Home, End and
   Enter (the model picker's rows, ←/→ for its agents) are taken only when no view handled
   them, so text fields keep their caret keys; a Modal is its own window, so the picker puts
   a second `KeyCommandsRoot scope` inside it, which holds focus on Android so the first
   arrow is not spent on leaving touch mode. Third-party native
   libraries: react-native-screens (native stack and sheets), gesture-handler, reanimated,
   keyboard-controller, quick-crypto (OpenSSL WebCrypto and Argon2id), expo-image,
   expo-haptics, expo-notifications, expo-secure-store, expo-sqlite.

## Protocol: reuse, do not reimplement

The client speaks to Pockymoe exactly as the Web does, through the relay with account keys
and the end-to-end encrypted owner transport, or directly to a local Supervisor URL.

- `vendor/pockymoe/` holds **verbatim** copies of the protocol code from the runtime repo:
  `packages/shared/src` (JSON types), the Web's account and relay transport modules
  (`accountCrypto`, `accountVaultState`, `accountAuth`, `accountTransport`,
  `relayTransportCrypto`, `sharedDeviceTrust`, …) and the shared UI's i18n bundles and pure
  logic (timeline, context inspection, and the composer model picker's ordering, search,
  catalog facts and readable handoff text), which the native screens render themselves. `scripts/sync-vendor.mjs` copies them from a runtime checkout and writes
  `vendor/pockymoe/SOURCE.json` with the source repository, commit SHA and a SHA-256 per file.
  `npm run vendor:check` fails when a vendored file was edited by hand.
- The few Web modules that touch browser-only storage or globals are **replaced at module
  resolution** (Metro `resolveRequest`, and the same aliases in vitest), never patched:
  `accountStore` (IndexedDB → SQLite KV + Keychain/Keystore for private keys),
  `relayOrigin` (the configured relay), `webBase`, `browserLabel` (device name),
  `tourSandbox/tourDevice` (no tour), `pendingEnrollmentStore` and the i18n entry
  (`@pockymoe/thread-ui/i18n` → `src/i18n`). The replacements live in `src/platform/web/`.
- `src/platform/polyfills.ts` installs react-native-quick-crypto as `globalThis.crypto`
  (native OpenSSL: ECDSA P-256, ECDH, HKDF, AES-GCM, HMAC, SHA-256), URL, streams and an
  event bus for `window` events. Argon2id runs natively (quick-crypto) behind the same
  `argon2id` signature the Web takes from `hash-wasm`.
- `src/protocol/transport.ts` is the native counterpart of the Web's `relayTransport.ts`
  (which needs a service worker): it calls the vendored `exchange()` for every device request
  and wraps the vendored `SocketCipher` in a WebSocket-shaped class.
- `src/protocol/api.ts` is the typed REST surface the screens use, with paths and bodies
  taken from the Web's `api.ts`.
- Tests (`vitest`, Node) run the vendored code through the same aliases: vault create/open,
  browser certificates, request signatures and HPKE request/response round trips against the
  Web's interop vectors, and a lab test against a real relay and Supervisor.

## Connection runtime

One owner per connection (`src/connection/`), as in T3's client runtime:

- A *connection* is a relay account (cookie session + account key) or a direct Supervisor
  (URL + optional passcode token). Each has a supervisor loop that owns retries: jittered,
  capped backoff; foreground, network change and explicit retry probe the session instead of
  reconnecting blindly; auth failures wait for the user.
- Transport health and data freshness are separate: a live socket does not mean a thread
  subscription is current. Cached lists stay readable offline but are marked stale.
- Thread detail: one live subscription per open thread (socket with `threadId`), a short cache
  for fast back navigation, events applied with the shared `mergeThreadHistoryItem` and
  `mergeLatestThreadTurns`. Reconnecting never replays mutations.

## Screens (scope order)

1. Connect: relay origin → sign in (account key) or direct URL (+ passcode); devices with
   connection and protection marks.
2. Workspaces, thread list (status marks, search, starred, recent), new thread (workspace,
   agent, model, effort, worktree).
3. Thread: transcript (markdown, code, images, tool runs, folding, streaming), approvals and
   questions, stop/steer/queue, composer (text, photos, camera, files, model/effort, quotes,
   harness switch).
4. Notifications through the existing relay notification path.
5. Git (status, diffs, turn changes, restore with undo, commit/push, PR), Files, Settings.
6. Tablet/iPad columns and inspector; foldables; landscape.
7. Motion, haptics, empty/error/offline states, accessibility, zh-CN/en, performance.

## Theme

`scripts/gen-tokens.mjs` reads the Classic tokens (`matter-theme.css`, shared UI
`matter-workbench.css`) and the built-in packs (`themes/plum-pocket`, `themes/terminal`) and
writes `src/design/tokens.generated.ts`: one token set per preset and mode with the same names
(`bg`, `panel`, `surface`, `fg`, `fgSoft`, `fgMuted`, `border`, `primary`, `accentSoft`, …).
Packs change appearance only: palette, fonts (Nunito/Fredoka for Plum Pocket, monospace for
Terminal), corner radius, avatars and small controls. Status marks keep their shapes in every
preset (`docs/ui-principles.md` §6).

Agents look the same everywhere (lists, composer, dock, new thread, model picker): `AgentMark`
draws the Web's mark, the pack's art where it has some (Plum Pocket's avatars; Terminal's square
tags, drawn natively from `terminalMarks.generated.ts`, which the vendor sync derives from the
pack's SVGs because Android's SVG decoder drops `&gt;`), else the Web's two-letter monogram in
the agent's colour (`AgentChip`, thread-map.css).

## Build

- Android on Linux: JDK 17 and the command-line SDK (`JAVA_HOME`, `ANDROID_HOME`);
  `npm run android:prebuild` then Gradle (`npm run android:release` builds a standalone APK
  with the embedded bundle). No EAS, no accounts.
- iOS: `expo prebuild -p ios` keeps the project generable on Linux; building needs a Mac.
- `android/` and `ios/` under `native/` are generated (Continuous Native Generation) and not
  committed; native behaviour lives in `app.config.ts`, config plugins and `modules/`.
