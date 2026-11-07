# Desktop pet

The main process owns one fixed transparent character window and one reusable,
parented glass window. Only dragging, size changes and display changes can alter
character bounds. The glass child resizes to its compact controls, merged activity
panel, pill bubble or More menu. macOS uses native HUD vibrancy. Windows 11 22H2+ requests native Acrylic in a nontransparent frameless child. Older
builds use a transparent child with the design’s opaque solid fallback. Theme tokens supply a .5px hairline, 14px capsule /
12px bubble corners (Terminal stays square), and the shared shadow. `POCKYMOE_WINDOWS_GLASS=solid` forces that fallback if real-device QA
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

Pet surfaces use content widths capped at 280px, centered with a 6px sprite gap.
Running rows are 28px, with 2px gaps, adjacent device metadata and middle-truncated
titles; after four rows, a 22px More row opens the existing activity panel. The
control bar retains 28px hit targets around 24px visual boxes. Sticky bubbles
use at most three text lines (title plus two summary lines) and expose full text on hover or existing title-button focus,
without rebuilding rows or moving sprite bounds. Mac tint is 70% / hover 80%;
Windows Acrylic is 85% / hover 95%, while the solid fallback remains opaque.
The `compact surfaces` Electron tests cover layout, focus, CSS contrast and an
optional Windows CI desktop-capture probe. See the Windows design doc for the
measured CSS values and the distinction from native Acrylic measurements.

Slender packs side-peek through a face-derived head crop, with a neck pivot and
fixed face height. Rendering, clipped alpha hit testing and hover bounds share
`dockedPose`; MOE retains its existing body-centered peek. Compact surfaces use
the shared status shapes at 10px, including the running ring and waiting bubble.

### Streaming clips and dedicated edge heads

Legacy packs (no `clipFormat.mediaType`) keep their WebP atlas player, six-sheet
cache, 512-pixel cells, 60 fps / 512-frame caps, 8 MiB per sheet and 160 MiB of
clips. They require no conversion. New packs opt into streaming explicitly:

```json
{
  "remoteCodex": {
    "clipFormat": {"mediaType":"webm-vp9-alpha","width":648,"height":702,"fps":24,"columns":4},
    "clips": {"idle":[{"path":"clips/idle.webm","frames":240}]},
    "faceBox": [0.4,0.24,0.62,0.36],
    "talk": {"path":"clips/talk.webp","frames":4},
    "peek": {"path":"peek.png","width":1536,"height":1024,"anchor":[0.9,0.6],"headHeight":0.6,"bounds":[0.42,0,1,1]}
  }
}
```

`columns` still describes the optional **WebP speech strip**; WebM contains
individual video frames. Talk remains 3–8 complete frames, with the same source
cell dimensions. Its final canvas, like the animation canvas, uses the full
CSS size × devicePixelRatio backing size. Resizing or changing scale repaints it.

Streaming limits: 32 MiB per WebM, 256 MiB for all expanded declared pack files,
12 seconds / 360 frames per clip, ≤30 fps, ≤1024 per axis and ≤786,432 pixels per
frame. The ordinary thumbnail atlas and speech strip retain their 8 MiB limits.
Validation checks EBML magic, WebM DocType, a single un-laced VP9 video track,
alpha metadata, dimensions, default frame duration, block count and container
duration against the manifest. Extension alone is insufficient. Missing,
undeclared or mismatching ZIP entries fail before atomic replacement. An old
client cannot read this opt-in format: install a compatible client **before**
importing the new pack; keep a backup of the old pack.

Only the isolated local session handles `pockymoe-pet://media/<capability>`.
An active pack gets random, revocable URLs, not filesystem paths. Responses are
streamed from an opened regular file with `video/webm`, `Accept-Ranges: bytes`,
correct bounded/open/suffix single-range 206 responses, 416 for invalid ranges,
and HEAD support. CORS permits the local file renderer to read its drawn alpha;
the remote Web partition has no handler or capabilities. CSP allows this media
scheme only, not arbitrary remote or Blob videos. Video elements are decoded
natively, drawn to canvas, and removed with their source on eviction. At most
one active and one upcoming decoder exist. The previous canvas remains until
its replacement's decoded first frame is ready; no blank intermediate canvas is
shown. State changes hurry the playing video toward the final rest endpoint
within 600 ms (legacy WebP retains its nearest-end behavior).

`peek` is optional. Its path is exactly `peek.png` or `peek.webp`; dimensions are
positive integers ≤4096 with ≤8,388,608 pixels total and must match the image header. `anchor` is the normalized
right-source point where the half-face line crosses the screen edge (ordered
x,y, strictly inside the image). `headHeight` is the normalized crown-to-chin
height, .1–1; it scales to twice the face-box height. `bounds` is the normalized
visible-art bounding box `[x0,y0,x1,y1]`, ordered in [0,1]. Keep the cropped face
side past the anchor so it stays offscreen even in the fuller alert peek. Leave
room for the complete gravity-hanging hair and tapered strand tips, with transparent
margin below. `bounds` must include the hair ends: docked controls go below those
ends (or above the head when there is insufficient space). Keep the scaled bounds
inside the fixed pet viewport so near-bottom docking cannot cut them off. Left edges mirror both image and geometry.
`alertAnchor` optionally gives a second normalized source x crossing for the
fuller alert (at least anchor.x and strictly inside bounds.x1). Place it where
the full face is visible but the back of the skull and hair still cross the
physical edge. Without it the crossing stops 4% of image width inside the art
bounds; the renderer never slides the whole cutout clear of the edge.
Side docking uses this head alone without rotation, at the undocked face's
vertical anchor. Alerts slide the same head further into view. The outgoing body/head fades out over 80 ms before the incoming head/body
fades in over 80 ms; both directions use the same timing and never overlap.
The body moves behind the physical edge during its outgoing phase. Painted alpha supplies the click mask. Slender packs also cap top/bottom rest and alert reveals at the head, hair and
collarbone, with the collar cut kept behind the physical edge; no chest is
revealed. MOE retains its existing top/bottom geometry. Packs without peek art keep their existing pose geometry with a
feathered lower crop boundary. Docked controls, running stack, bubble and panel
anchor to `dockedPose(...).visible`: 6 px gap; side edges have an 8 px work-area
inset and grow inward; top is below, bottom is above. A visible surface keeps
its chosen side when it grows, preserving pointer/focus stability.

The pose builder's optional `--webm --sr-weights /local/realesr-animevideov3.pth`
outputs 648×702 VP9-alpha. Install torch, Pillow, numpy, scipy, OpenCV and
imageio-ffmpeg in a local build venv and run with `python -I`. Weights are from
[Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN); inspect downloaded code and
keep it and weights outside the repository. This tool never downloads them and
loads weights with `weights_only=True`. It restores each normalized source key
(including speech and bed poses) once, then applies motion and flow at delivery
resolution. `--soften .25` lightly softens restored RGB outlines in output pixels;
alpha is preserved. Flow uses forward/backward consistency, single-source
warping and rigid head protection. Ambiguous occlusion holds the nearest sharp
key instead of blending a doubled limb. Atlas output stays compatible. `--peek`
copies a local approved head asset using metadata from the plan's `peek` field.

`test/petMedia.e2e.ts` generates non-character geometric PNG frames and encodes
its own alpha WebM with `POCKYMOE_FFMPEG` (or ffmpeg on PATH). After building the
isolated harness, run it with the explicit Electron project. The dedicated
`pet-media-windows.yml` job exercises the same native playback, alpha,
two-decoder handoff, range requests and capability revocation on Windows. No
custom-character assets or weights are needed or uploaded by that job.

Tucked packs with clips always hold a real first frame from their idle/rest clip
(or the first available loop when no idle clip is declared), on the full-DPR
clip canvas. This applies to all four edges and both media formats; the atlas
is used only for packs/states with no decodable clip. Video decoding pauses on
frame zero and discards the unused preload while tucked. Dedicated side art
still covers that held body frame. Alpha hit testing uses the held clip pixels.

### Rive packs (branch prototype)

Rive is optional; the atlas, WebP and VP9-alpha players remain available. Declare:

```json
{"spritesheetPath":"spritesheet.png","remoteCodex":{"rive":{"path":"pet.riv","artboard":"Pet","stateMachine":"Pet"},"faceBox":[0.25,0.28,0.75,0.64]}}
```

`spritesheetPath` remains the catalog thumbnail and decode-failure fallback. Rive
wins over clips while loaded. This prototype uses **state-machine inputs**, not a
ViewModel: omit `viewModel`. A declared ViewModel is rejected explicitly rather
than silently binding the wrong interface. Names are case-sensitive, and types
are checked before installation:

| Input | Type / values |
| --- | --- |
| `state` | number: idle=0, running=1, waiting=2, failed=3, review=4, sleeping=5, resting=6 |
| `complete`, `fail`, `poke`, `dragStart`, `land`, `wave` | trigger; fire once per reaction/drag boundary |
| `mouth` | number 0–1, from the existing Web Audio RMS, 60 ms attack / 120 ms release |
| `lookX`, `lookY` | number −1…1, from the controller's existing 100 ms cursor poll |
| `dragging` | bool |
| `dock` | number: none=0, left=1, right=2, top=3, bottom=4 |

Completion (`waving` or `jumping`) fires `complete`, failure fires `fail`, clicks
fire `poke`, and drag boundaries fire `dragStart`/`land`. `wave` is available to
authored packs and preview; there is no separate wave command in the current UI. Repeated
reaction epochs replay triggers. Sustained controller mood semantics are unchanged.
`resting` is available to authoring/preview. Automatic resting requires the
optional Rive motion plan described below; packs without it retain direct state control.

Only `pet.riv` is accepted, up to 16 MiB. ZIPs and Rive folders must contain exactly
`pet.json`, its atlas, `pet.riv`, and any declared sleeping/peek/clip files. Existing
path, symlink, image and ZIP limits still apply. Import requires a test-load in a
fresh sandboxed renderer with no preload or host bridge. It checks selectors and
all typed inputs, advances each state, disables asset CDN loading, bounds the
operation to 15 seconds, then destroys the renderer before atomic installation.
Rive Scripting is **not filtered out**; imported scripts execute in the runtime's
sandbox. Script authoring is outside the writer's subset.

`@rive-app/webgl2-advanced` is pinned to **2.49.4**, with bundled local primary and
fallback WASM. The drawer owns advancement, clearing, transparent WebGL2 rendering
and a one-pixel `readPixels` immediately after drawing. Canvas backing size follows
full devicePixelRatio. The existing docked geometry/masks still apply. Tucked
pets stop time advancement; settled machines stop drawing until inputs or size
change. Runtime failure keeps the atlas visible.

Writer/schema provenance, rig shape, sample build and preview commands are in
[`art/tools/rive/README.md`](../../art/tools/rive/README.md). This is a prototype,
not a published pack-format compatibility promise.

Rive packs may opt into full motion choreography with `rive.motions`. Each state
maps to an ordered list of `{value, durationMs, role?}` beats; `value` is an integer
0–1023, duration is 16–60000 ms, and `role` is `intro` or `outro` when needed.
Supported keys match raster clip states (including dragging, landing and resting).
Such packs must also expose `motion:number` and `motionStart:trigger`. The pet
sets the selected value and fires motionStart once at a beat boundary; author an
Any-state transition conditioned on both. The original state/trigger contract
remains available for standalone playback. The pack's state machine should give
motionStart priority and avoid repeatedly transitioning to the current state.

The pet uses the shared ClipSequencer for intro/loop/outro ordering, the 8% idle
rest chance, 1–4 minute resting duration and wake-up outro. Idle variants are
shuffled each cycle (neutral intervals retained); work and reaction variants cycle.
One-shot reactions hold their final frame until the controller's reaction expires. Reaction
durations come from the motion plan; Rive landing beats run after drag release.
Time advancement pauses while tucked. This behavior applies only to opt-in Rive
motion plans; raster packs retain their previous sequencing.
