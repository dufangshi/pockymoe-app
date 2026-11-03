# Desktop pet

The main process owns one fixed transparent character window and one reusable,
parented glass window. Only dragging, size changes and display changes can alter
character bounds. The glass child resizes to its compact controls, merged activity
panel, pill bubble or More menu. macOS uses native HUD vibrancy. Windows 11 22H2+ requests native Acrylic in a nontransparent frameless child. Older
builds use a transparent child with the design’s opaque solid fallback, 1px border and
12px corners. `POCKYMOE_WINDOWS_GLASS=solid` forces that fallback if real-device QA
finds native corner artifacts or flicker. Other platforms retain the translucent fallback. An interactive panel
focuses and closes on native blur or Esc; passive bubbles never take focus.

```ts
import { createPetController } from '../pet/controller';
const pet = createPetController({ hub, settings,
  appearance: appearance.get, onAppearance: appearance.onChange,
  dispatch: command => windows.dispatch(command),
  shouldSpeak: event => notifications.shouldSpeak(event),
  petDirectories: [bundledPetsDirectory, userPetsDirectory],
});
// On shutdown: pet.dispose(). Settings changes are observed automatically.
```

The build entries remain `src/pet/preload.ts` → `out/preload/pet.js` and
`src/pet/index.html` → `out/renderer/pet/index.html`. Both windows share the local
renderer and sandboxed, named `rcDesktop.pet` methods. IPC verifies the sender and
its top frame. No relay credentials enter either pet window.

The hub is the authority for per-device connection baselines and the 60-second
missing-item grace period. The pet never generates reactions from snapshots:
only new hub events trigger one-shot failure/completion reactions. Sustained
poses are waiting/running/idle, with a two-second minimum dwell and 160ms sprite
crossfade. Snooze uses the full-colour optional sleeping strip. `petEdgeHide`
defaults to true; docking bisects the pack’s face inside an on-screen fixed
window (bottom: head and eyes), using the idle/rest atlas pose while tucked, slides out after 150ms hover and tucks after 800ms away. Alerts expose more of the head. `remoteCodex.faceBox` supplies fractional
`[x0,y0,x1,y1]` bounds; MOE and older packs use `[.22,.4,.78,.8]`. Only
the visible sprite pixels accept clicks. Cursor proximity
is polled in main at 100ms, independent of alpha hit testing.

The activity panel has a text-free 26px icon/close strip. Each conversation has
one row keyed by `rootThreadKey ?? key`, with its highest-priority status and a
robot/count tooltip listing participating child names. Selecting a conversation
expands multiple pending requests; approval actions retain each actual request
identity. Replies target the root until a request is explicitly selected. Inactive
roots get a valid derived route even when only a child is active. Metadata stays
in tooltips or the right-aligned device; no role prefix is added to panel/pill copy.
Bubbles coalesce mixed event kinds by conversation and preserve per-request
acknowledgements. Opening a conversation bubble acknowledges its actual alerts.

Codex v1 (1536×1872) and v2 (1536×2288) are supported. The first nine rows retain
the official hatch-pet timings; v2's last two rows are reserved for pointer-look
poses, and idle column 6 is not played. Sources are linked in `animation.ts`.
Optional `remoteCodex.frameScale` slows per-frame timing. Sleeping strips and
frameScale are validated independently. Import validates dimensions, size caps,
ZIP paths, symlinks and decoded pixels before atomic installation under userData.
On Windows, ZIP components and installation IDs also reject device names (CON,
NUL, COM1, etc.), alternate streams and trailing dots/spaces. Backslashes, drive
prefixes and traversal are rejected before archive entries reach the filesystem.
All positioning remains in Electron DIP work areas, including taskbar insets;
125/150/200% scaling, cross-monitor movement and full-screen behavior still require
physical Windows verification.
The shell may call `importPetPack({ settings, petDirectories, parent })`.

`moe` (MOE) is the only built-in pack and the default; its source and build tools
remain in `desktop/art/moe/`. Every other pet is imported by the user. The
procedural placeholder is a test fixture under `desktop/test/fixtures/pets/`,
never a shipped pack.
Native Preferences/About display each pack's credit via the shell's pet catalog.

Focused checks from `desktop/`:

```sh
pnpm exec vitest run --config src/pet/vitest.config.ts
pnpm typecheck
pnpm exec eslint src/pet
pnpm build
POCKYMOE_DESKTOP_EVIDENCE=<evidence-root> pnpm exec electron-vite build --config src/pet/tools/electron.config.ts
POCKYMOE_DESKTOP_EVIDENCE=<evidence-root> node src/pet/tools/round3.mjs
POCKYMOE_DESKTOP_EVIDENCE=<evidence-root> node src/pet/tools/round3-real.mjs
```

`round3.mjs` uses an isolated mock hub and checks Classic/Plum Pocket/Terminal ×
light/dark × 1440/900 work areas, all four dock edges at S/M/L, fixed bounds,
Dock visibility, blur/Esc, request errors and drafts. `--smoke` limits the visual
matrix. Virtual secondary-display geometry is checked separately; macOS clamps
native windows to connected physical displays.

`round3-real.mjs` uses the already-running backend fixture, a fresh temporary
profile and real page sign-in. It records the first login minute, tests a live
approval/completion and page-language sync, and captures native glass only over
the foreground fixture window. It never logs authentication values or restarts a
service. Prepare ≥250 historical fixture threads before the acceptance run.
Evidence is written under `<evidence-root>/round3/pet/`. The earlier v2/QA1 tools
are superseded by these v3 scripts.

For conversation grouping/routing and native panel/bubble captures:

```sh
POCKYMOE_DESKTOP_EVIDENCE=<evidence-root> node src/pet/tools/conversations.mjs
POCKYMOE_DESKTOP_EVIDENCE=<evidence-root> python3 src/pet/tools/conversations-fixture.py prepare
POCKYMOE_DESKTOP_EVIDENCE=<evidence-root> node src/pet/tools/conversations-real.mjs
POCKYMOE_DESKTOP_EVIDENCE=<evidence-root> python3 src/pet/tools/conversations-fixture.py cleanup
```

The mock capture matrix holds virtual focus to avoid foreground contention;
real-app capture uses native focus, actual page Settings, a real five-child fixture
conversation and only foreground fixture-window screenshots. Both cover three
themes × light/dark × 1440/900 × en/zh-CN. Fixture preparation/cleanup uses public
HTTP and records only owned disposable thread ids outside the repository.

A pet travels as one zip, imported from Preferences. Its root holds `pet.json`, the atlas it
names and, optionally, `sleeping.webp` and `clips/*.webp`, and nothing else. Importing a pack
with an id already imported replaces it; `moe` is refused; former built-in id `frost` is now a normal import. `art/tools/build_clip_pack.py`
writes such a zip from alpha WebM videos, and `art/tools/build_pose_clips.py` from generated
pose sheets, turning a few drawings into motion.

`remoteCodex.sizeScale` (0.5 to 2) multiplies the window height for a pack, because a slender
adult figure needs more height than a chibi to read at the same size. In a pose plan, `grid`,
`width`, `height` and `sizeScale` set the sheet layout and cell, `wind` adds hair and veil drift,
`effects` keeps separate marks such as a floating light, and a beat's `face` paints only the face
of another pose, so a blink doesn't redraw every strand of hair.

A clip in `remoteCodex.clips` can carry `role: 'intro'` or `'outro'`, playing once on entering or
leaving its state, outside the cycle, so a pose held throughout a state is reached and left by real
motion. `ClipSequencer` (`clipSequence.ts`) picks what plays next. A pack's clips should start and
end on the state's resting pose: a change of state hurries the current clip to its nearer end within
600ms rather than cutting away mid-movement. The optional `resting` clips are not a state: with
nothing running, each idle clip that ends has an 8% chance of leading into them for one to four
minutes, and she gets up when the time is over or anything happens.

`build_pose_clips.py` scales every pose so its head matches the first pose's and tweens between
drawings along the optical flow, which needs `opencv-python-headless`.

Agent alerts use `conversation.agent` (unnamed: `conversation.智能体` /
`conversation.agent`); root titles stay plain. Merged agents use
`conversation · n child threads`, with English singular/plural. Local titles
ellipsize the conversation in the middle and retain the agent suffix. Routing,
activity grouping and running counts are unchanged. Speech identifies both names,
and summary prompts explicitly carry agent-thread kind, conversation and agent.

Preferences → Pet → Agent threads stores `petAgentAlerts` (`all` by default,
`silent`, `off`). The delivery policy suppresses completed/failed agent alerts in
`off`; `silent` retains bubbles/chimes/system notifications without speech or
summary requests. Waiting-for-input alerts keep their existing delivery. Stricter
mute/focus/snooze rules still apply. The setting is validated, persisted and
excluded from both Web PageSettings reads and writes.

Optional speech faces use `remoteCodex.talk: {"path":"clips/talk.webp","frames":4}`
with `remoteCodex.faceBox` and `clipFormat`. Frames use the clip grid: closed,
half open, open; up to five additional open variants (for example rounded “o”)
can follow. The renderer samples the playing speech through a Web Audio analyser,
uses RMS with 60 ms attack / 120 ms release and thresholds .018 / .055, then
switches visually to a `talking` rest pose, painting only the feathered face
over the closed frame’s fixed body. The underlying action resumes after speech. Open variants
alternate every 180 ms. Silence paints the closed frame; speech end removes the overlay. The pose tool’s
±8 pixel translation search cannot align arbitrary bent/lying heads, so the
rest-pose fallback avoids detached faces; feather sigma is face height / 8. Packs without talk retain their existing
visual behavior. This is loudness-driven mouth motion, not phoneme recognition.
Face boxes must be finite, ordered fractions in [0,1]; talk requires 3–8 frames,
a safe declared clip path, and a format. Talk bytes count toward the same 8 MiB
per-sheet / 160 MiB total clip limits, including ZIP import. Clips allow up to
512 frames and 60 fps. The pose builder renders at 24 fps with eased ten-frame
transitions, scaling 15 fps plan durations; an explicit plan `fps` changes that
source time base. Existing WebP qualities stay unchanged. The pet renderer disables
Electron background throttling; clip frame selection follows elapsed time via rAF.
