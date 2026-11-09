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
The speech bubble follows the audio, not the alert (`speechBubble.ts`): the renderer reports
when a line starts and ends, because synthesis takes seconds and only the newest of a backlog is read.

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

Only `pet.riv` is accepted, up to 96 MiB. Layered drawing variants can exceed a single raster clip; the expanded pack cap remains 256 MiB. ZIPs and Rive folders must contain exactly
`pet.json`, its atlas, `pet.riv`, and any declared sleeping/peek/clip files. Existing
path, symlink, image and ZIP limits still apply. Import requires a test-load in a
fresh sandboxed renderer with no preload or host bridge. It checks selectors and
all typed inputs, advances each state, disables asset CDN loading, bounds the
operation to 30 seconds, then destroys the renderer before atomic installation.
Rive Scripting is **not filtered out**; imported scripts execute in the runtime's
sandbox. Script authoring is outside the writer's subset.

`@rive-app/webgl2-advanced` is pinned to **2.49.4**, with bundled local primary and
fallback WASM. The drawer owns advancement, clearing, transparent WebGL2 rendering
and synchronous CPU silhouette lookup. Grabbing never queues GPU alpha probes;
older packs without baked masks use a conservative artboard rectangle. Canvas
backing size follows full devicePixelRatio. Docked geometry still applies. Tucked
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

Rive packs with a shared skeleton may opt into pet-side dynamics:

```json
{"procedural":{"bodyBone":"body"}}
```

This lives inside `remoteCodex.rive`. `bodyBone` must name a root bone.
Installation additionally requires number
inputs `blink`, `breath`, `weightShift`, `swayHair`, `swayGown`, `swayWings`, and
`dragLean`. Author their blend layers on separate child bones so they combine
with the pose rather than replacing it. Hair/gown/wing values are −1…1; blink
and breath are 0…1. The drawer reads the animated body's world translation and
rotation. Damped springs respond to its acceleration and to window drag velocity,
integrated in steps of at most 1/120 s; stale drag samples expire after 120 ms.
Random blink intervals and incommensurate breathing/shift phases continue on
all authored poses. Closed-eye sleeping art may mask the blink layer.

Procedural rigs advance at the display's `requestAnimationFrame` cadence, including
120 Hz displays. `idleFps`, `activeFps` and `sourceFps` remain accepted as legacy
manifest fields but no longer cap rendering or hold body time. Bones and vertices
interpolate continuously between authored keys; breath, weight shift and spring
inputs are not quantized. Draws are skipped only when size, inputs and the
artboard are unchanged, or while tucked/reduced motion holds the pose. Speech
keeps the existing 60/120 ms envelope.

For planted poses, author breathing on spine/chest/neck or spatially weighted
control points above the hips. Root translation, root scale and a whole-body
weight-shift layer move the feet and must not be used for kneeling idle art.

A procedural pack may additionally set `eyeOpen:true` and provide a number
input named `eyeOpen`. The pet sets this to 1 for a cursor gaze and 0 otherwise.
For sleeping/resting poses it requires the cursor within a region three pet
widths/heights centred on the character, so a distant cursor does not wake a
closed-eye bed pose. Blink can close the same eye overlay above this channel.
This lets one shared eye drawing respond to both gaze axes without submitting
two overlapping eye images. Explicit preview gaze values open this channel.

An experimental `rive.dissolves` compositor can retain the existing Rive drawings
and insert local drawing exchanges without trimming or reversing source time:

```json
{"stateMs":450,"bedMs":550,"clips":[{"value":0,"windows":[
  {"atMs":750,"durationMs":350,"regions":[[0.2,0.2,0.8,0.8]]}
]}]}
```

Times are milliseconds; rectangles use normalized artboard coordinates. Each
window holds the two coherent material charts while procedural inputs can keep
moving. Outside windows the source clock advances normally at display rate.
State changes retain the last visible composite and start the destination
immediately, completing the fade in `stateMs` (300–500 ms), or `bedMs` (400–600 ms)
when a clip boundary is not `rest`. Blink, mouth and gaze paint yield during a
fade. Hit testing uses the union CPU mask during exchanges.
Clip entries can also declare `overlayYieldMs: [[startMs,endMs], ...]` for unsafe
source-time intervals beside a chart exchange. This covers interpolated samples
where a face patch starts travelling before the painted head changes. Verify
forced overlays at display cadence as well as at the original source samples.

The GPU compositor interpolates premultiplied colour and preserves union alpha.
This prevents transparent fringes but can expose overlapping contours or outline
pops. It is a pilot path, **not a certified motion repair**. Qualify each pack
with colour, alpha-union and visual checks before enabling it. It requires this
runtime; older clients do not implement this timing or composition. Packs without
`dissolves` use their existing renderer and router unchanged.

Source drawing packs may additionally opt into `rive.routing` with
`clips` (`value`, `animation`, `durationMs`, `start`, `end`, optional
`loop`) and `bridges` (motion values). Boundary names describe **identical shared
paint, selectors and bone coordinates**, not just a similar pose. The loader
checks animation references; import validation requires a connected bridge graph.
On interruption, the pet-side router scrubs the active clip to its nearer end,
then plays required bridge clips completely. Native legs run at source speed;
other legs use smoothstep with a peak speed of 1.5× natural speed. `maxExitMs`
remains accepted for old manifests but no longer truncates the route. It never
blends incompatible material charts. Reverse legs last at least 100 ms, so a
second event immediately after entry cannot reverse a whole clip in one sample. A later
interrupt replans from the currently displayed position. Normal choreography and
random resting still use `RiveMotionClock`; its beat clock pauses during exit.
The body is applied with `LinearAnimationInstance`; the state machine owns the
procedural layers. Such files must not also animate the body from their machine.

`rive.backing: {width, height, scale}` caps the backing store to native source
resolution × scale (1–1.25), preserving aspect ratio. CSS controls visual size;
hit masks use normalized artboard coordinates. Opted-in bitmap drawing packs
use the pinned runtime's inkbleed renderer option to avoid native MSAA; ordinary
packs retain the existing renderer and full DPR. The native-size cap has no effect
when the pet's CSS size × DPR is already below it. The prototype binary limit is
96 MiB for lossless source drawing atlases; expanded ZIPs remain capped at 256 MiB.

Routed source drawings now use continuous source time at every display frame.
Material selection uses that same float32 clock. Drawing keys must still share
matching material coordinates; higher sampling cannot repair incompatible paint.
Authors must fit inbetweens and supply shared boundaries or dedicated transitions.

Legacy `exitAnimation` and `exitRestMs` metadata remain import-compatible but
no longer accelerate, flatten or snap an exit to rest. Complete authored legs
supply the transition. Zero-time procedural/draw passes retain the displayed
sample and cannot consume a boundary hold.

`procedural.transientFace:true` requires `eyeOpen:true`. Gaze activates only for
nearby cursor movement, holds for 180 ms, then fades to source paint over 180 ms.
The cursor target interpolates at display rate between the 100 ms IPC samples.
The authored eyeOpen layer must expose the original source pupils through an eye
mask, and zero input must show source paint. Blink layers should use the current
expression's lids and return to opacity zero; mouth layers should preserve its
lip corners and mood. Closed source eyes stay closed unless the pack explicitly
authors a wake expression. Overlay charts must remain registered throughout the
complete authored exit. Preview capture accepts explicit procedural input overrides for repeatable
blink, gaze and speech comparisons.

Rive always uses the pinned `@rive-app/webgl2-advanced` runtime. Software WebGL
presentation can incur Chromium readbacks even with zero app alpha probes. The
built-app benchmark separates that presentation cost with a matched quad control;
it does not infer a different renderer from Chromium's feature-status labels.

Optional `routing.reactions` entries declare `{clips, targets, animation,
durationMs, settleMs, resumeValue?, resumeTargets?, drawings?}`. These are authored
reactions on the current material chart, useful for an event in a lying or
suspended pose. `drawings` is an optional, strictly time-ordered list of
`{atMs, animation}` entries fitted to successive source drawings. The player
selects the latest entry at the displayed body time, including while that clock
decelerates, and advances its animation at the independent reaction time. Material
selection uses the same continuous float32 source clock as the body sample. Before
the
first entry it uses `animation`. All variant names are test-loaded during isolated
import validation. The displayed body clock decelerates over `settleMs`
(50–400 ms), then holds while the separate
reaction animation plays; it never selects the requested upright clip's body
drawing. The logical target is reported in `route.value`, while
`route.animation` and `route.time` identify the actual body sample. A subsequent
normal motion uses the shared-boundary router. An interrupted reaction finishes
its authored forward gesture at natural speed,
retains the endpoint and then routes the latest queued request. There is no
350 ms time-warp or backward reaction reversal.
New requests replace the queued request.
`resumeValue` and `resumeTargets` let non-waking requests resume the held lying
pose without seeking back to its first frame. These resume targets also apply
before the first reaction: an idle/waiting request cannot accidentally wake an
already lying character. Authors select which requests need an awake pose.
A routed clip with `nativeExit:true` finishes forward at source
speed, also when it is used as a bridge. This preserves complete bed-out and
landing performances; these protected exits deliberately take longer than the
eased shared-rest route. `nativeExit:"nearest"` returns a loop to its nearer shared
boundary. Forward exits keep source speed; reverse exits ease into the return
with a peak of 1.5×, avoiding an instantaneous velocity reversal. Every drawing
key remains on the route. Such a reaction is not a shortcut
for a complete waking or landing bridge; authors must supply those performances
for their desired transitions. Reaction-owned properties must have neutral reset
keys in every body animation. Import validates references and time bounds, and
the isolated runtime verifier loads each reaction animation.

Record reactions at their actual display size with
`node art/tools/rive/record.ts PACK OUTPUT SCENARIOS.json 24 189x205 2`.
The final arguments specify CSS size and DPR (1 or 2); recordings include those
values in their metadata and preserve the corresponding backing-store pixels.

An optional routed clip `exits` declaration supplies fitted forward exits:
`{everyMs:500,durationMs:1250,animationPrefix:"work-exit-",end:"rest"}`.
Author animations numbered from zero through `ceil(durationMs/everyMs)`, with the
last starting at the clip's exact endpoint. Each must start with the exact source
material and pose at that time and finish at the named shared boundary. An event
continues forward to the next exit, then plays it at natural speed. Another event
finishes that exit forward before entering its new destination. Import test-loads
every named animation. Timing metadata alone does not establish visual continuity;
authors must verify every exit and entry at multiple source phases.

An exit may add `responses:[{targets:[13,14,15,16],animationPrefix:"poke-exit-"}]`.
Those destinations use the corresponding numbered animations instead of the default
exit bank, with the same checkpoint times, duration and final boundary. This lets
a poke start with visible acting while an ordinary departure lowers its prop.
Import test-loads both banks; a missing response animation rejects the pack.

With `sourcePose:true`, the drawer applies the source clip at the checkpoint time
before applying the exit animation. This shares the fitted bone pose instead of
copying it into every exit. Exit drawing and guard tracks then override the source;
an interrupted exit retains that same held pose until its forward path finishes.

`procedural.response:true` declares an additional numeric `response` input. The
drawer raises a smooth 480ms acknowledgment pulse on motion/state events and pet
triggers. Bind it to a small head/upper-body gesture while a longer route runs;
keep its layer separate from breathing and planted leg controls. It neither seeks
nor speeds up the source animation. `idleFps`, `activeFps`, `sourceFps` and
`maxExitMs` are legacy import metadata; new display-rate packs should omit them.

Both benchmark commands report renderer and GPU-process working-set memory in
MiB: OS peak (including startup), maximum sampled RSS and settled median of the
last ten one-second samples. The self-contained built-app command prints median
peak/settled memory alongside the three-run CPU table. The source recorder and
benchmark accept `RIVE_RECORD_SWIFTSHADER=1` and `RIVE_BENCH_SWIFTSHADER=1`
respectively to select SwiftShader explicitly; the production backend is unchanged.

Native readback counts are observed `GLES2::ReadPixels` trace events. Check
`drawCommandCoverage` before interpreting zero: some ANGLE paths emit no GLES2
draw events either, so the native readback count is unverified on those paths.
The built-app table labels that missing positive control separately from the
instrumented application alpha-probe count.

Rive grabbing uses an optional baked `rive.hitMask` instead of GPU alpha probes.
The mask has `width` and `height` (4–64), `clips` mapping motion numbers to base64
bit planes, and optional `extra` for reaction extensions. Bits are row-major,
least-significant bit first. Bake a slightly dilated union of every displayed
pose per clip; transitions use the complete union. Every routed clip must have a
mask. Transparent cells pass clicks through. An older Rive pack without a mask
uses its whole artboard rectangle conservatively, including transparent corners.

Windows/Linux install the mask as a native window shape. macOS uses forwarded
pointer moves and the synchronous CPU lookup; drawn frames also update the hit
answer when a pose moves under a stationary cursor. Neither path reads the GPU.
The capsule background drags both windows after 4 px of movement; buttons and
clicks without movement keep their existing actions. macOS pet and glass windows
accept the first mouse press. Native macOS delivery still needs testing on a Mac.

Focused native X11 grab checks accept either an installed pack folder or its ZIP:

```sh
pnpm exec electron-vite build --config src/pet/tools/electron.config.ts
PET_GRAB_SWIFTSHADER=1 xvfb-run -a node src/pet/tools/grab.mjs PACK.zip OUT
```

The harness records 250 random body grabs across five motion categories, 20
capsule grabs, desktop click delivery, capsule/button regressions, and app alpha
readback counts. Separate forwarded-input policy checks cover one move followed
by a press and motion under a stationary cursor using CDP on Linux; they do not
claim macOS OS delivery. Atlas and video hit testing retain their raster path.
