# Rive authoring without the Editor

Run from `desktop/` with Node 22.23+ and the desktop pnpm dependencies installed.
The writer uses Node's TypeScript stripping; preview uses the desktop's Vite,
Playwright, Electron and pngjs. No Rive Editor or hosted authoring service is used.

```sh
node art/rive-sample/make-rig.ts
node art/rive-sample/build.ts .scratch/rive/pack
xvfb-run -a node art/tools/rive/preview.ts \
  .scratch/rive/pack/pet.riv .scratch/rive/sheets Pet Pet --assert-motion
# Any other rig:
node art/tools/rive/writer.ts path/to/rig.json path/to/pet.riv
pnpm exec vitest run --config art/tools/rive/vitest.config.ts
pnpm exec tsc --noEmit --project art/tools/rive/tsconfig.json
```

The sample source and part PNGs are original art generated here in one paid LNZ
call. `art/rive-sample/cut.py` regenerates parts from `source.png` using Pillow.
The generated pack contains exactly three files; zip those files directly to
import it. Source art/rig/tooling is deliberately outside the importable pack.

`Rig` in `writer.ts` is the input schema; `art/rive-sample/rig.json` is a complete
example. Artboard dimensions, image placement and mesh coordinates are in pixels;
rotations are radians; UV coordinates are normalized. Image placement is the
image center. Image array order is **front to back** (Rive draws in reverse).
Mesh vertices are `[x,y,u,v]` relative to the image center; triangle indices are
unsigned varints. A skinned image must have unit scale; its parent may be an identity opacity group. Skeleton
parents precede children. A normal child bone starts at the parent's +X tip;
`offset:true` creates a RootBone with explicit local x/y under its parent.
Skin/tendon bind transforms are calculated from the rest pose. Distance to bone
segments gives inverse-square weights, retaining the nearest four influences;
byte quantization sums to 255. At most 255 tendons per mesh are supported.
For batching disconnected islands, `mesh.influences` may supply one array of
`{bone,weight}` entries per vertex, with one to four positive finite weights and
no duplicate bones. Bone names must belong to that mesh's `bones` list. These
weights use the same byte quantization; omitted influences retain distance-based
weighting. This preserves a part's original skin when combining mesh islands.

Animations have integer frame times, fps, duration, loop and tracks. Tracks name
an object and an animatable float property (`x`, `y`, `rotation`, `scaleX`,
`scaleY`, `opacity`, or a mesh vertex coordinate). Vertices are named
`<image>.v<index>`; root/child bones and images use their rig names. Each key has
frame/value and optionally `cubic:[x1,y1,x2,y2]`. State machines have typed inputs,
layers, entry/any/exit states, animation states or input-driven 1D blend states.
Transitions refer to state names within the layer, with duration/exitTime in ms
and ANDed conditions. Number ops are 0 ==, 1 !=, 2 <=, 3 <, 4 >=, 5 >; bool true
uses op 0, false op 1. Trigger conditions consume trigger inputs. ViewModels,
text, layout, audio, script authoring and arbitrary converter graphs are outside
this subset. The runtime can still load imported scripts.

Binary keys/field types come from the MIT runtime source at
[`a658a56a275ba473fe52e9d97a925d2468b0c853`](https://github.com/rive-app/rive-runtime/tree/a658a56a275ba473fe52e9d97a925d2468b0c853),
the runtime submodule of rive-wasm tag **2.49.4** (tag commit
`ada7b9f35f951ff491f65f5ffc74a3ed3c582203`). `schema.json` records that pin. Relevant
sources are `include/rive/runtime_header.hpp`, `src/core/binary_reader.cpp`,
`include/rive/generated/**`, `src/file.cpp`, and `src/importers/**`. The writer
emits RIVE header 7.0 with file id 0 and an empty property ToC: every emitted key
is known to the pinned runtime. Values use uint32 LEB128, LE float32, one-byte
bool, or length-prefixed UTF-8/bytes. Objects end in property key zero; EOF ends
the stream. Asset references index embedded images; component/curve ids index
the artboard (artboard=0), while animation/input/layer-state ids have their own
lists. Cubic easing uses concrete **CubicEaseInterpolator type 28**, not abstract
CubicInterpolator type 139. Unknown properties are rejected by the writer.

Preview fails on rejected files, missing artboard/machine, missing/wrong-type
contract inputs and blank frames. It drives all seven states, six triggers,
mouth/look ranges, both dragging values and all five dock numbers, producing
labelled PNG sheets. `--assert-motion` additionally requires at least eight
distinct rendered frames (useful for the sample, not a universal pack rule).
It also captures `electron-preview.png`. Output, bundled preview assets and
performance evidence belong in `.scratch/`, never maintained docs.

To measure the actual pet window against a local raster pack, build the isolated
existing harness, then run both sequentially under the same display/GPU setup:

```sh
pnpm exec electron-vite build --config src/pet/tools/electron.config.ts
xvfb-run -a node art/tools/rive/benchmark.mjs .scratch/rive/pack \
  .scratch/rive/benchmark-rive mint-courier 60
xvfb-run -a node art/tools/rive/benchmark.mjs /local/private/raster-pack \
  .scratch/rive/benchmark-raster raster-pack-id 60
```

`metrics.json` records a baseline and 60 one-second samples, actual elapsed time,
and cumulative CPU seconds of the pet renderer and GPU
**process CPU**, GPU feature/device information and memory. CPU percentages use
CPU-seconds divided by measured wall seconds, with one busy logical core = 100%;
they do not depend on Electron's normalized percentage or sampling intervals. GPU process CPU is
not hardware GPU busy percentage; virtual/software GPU runs do not measure a
physical GPU's utilization. The harness has an isolated account/profile, no
Supervisor connection, and produces pet-window and appearance captures.

`Rig.groups` adds identity-transform opacity nodes. A mesh may use one of these
as its parent while retaining artboard-space coordinates and skin binds; other
mesh parents are rejected. This lets a pose fade as one group while independent
mouth/gaze layers animate its children. Linear keys explicitly write the unset
interpolator sentinel (`0xffffffff`); cubic keys reference the pinned concrete
CubicEaseInterpolator.

For authored motion plans or arbitrary contract probes, preview additionally
accepts `--size 648x702 --scenarios /private/path/scenarios.json`. A scenario is
`{name, values, trigger?, frames}`: safe filename stem, typed input values, optional
one-shot trigger, and ascending sample times measured in 60 Hz frames. Each
scenario starts from a fresh machine and writes individual frames plus a labelled
sheet. The standard seven-state/six-trigger checks run afterward from a fresh
machine. With scenarios enabled their sheets use `state-` and `trigger-` prefixes
so a scenario named idle or failed cannot be overwritten by the contract probe.
Simulation advances at 60 Hz but only requested frames are drawn.
PNG decode waiting never advances the animation until its cached image repeats.
The preview's Electron profile stays under its output directory.
Large binaries cross the Node/renderer boundary as base64, avoiding millions of
serialized integer entries.

The isolated verifier accepts `OUTPUT --pack PACK --zip ZIP` to test a chosen
pack and its real ZIP installation. `RIVE_BENCH_CAPTURE=1` enables alpha and dock
assertions plus the full theme/dark-light captures for any benchmark pack ID.
Dock captures include all four edges in all six appearances. Benchmarks record
logical CPU count and actual elapsed seconds; one logical core = 100%.
`RIVE_BENCH_DPR=1|2` explicitly chooses the display scale (default 1); metrics
include actual DPR and CSS/backing canvas dimensions. Compare both formats at
the same DPR. WebGL readbacks count actual Rive draws, including hit testing.
The benchmark reloads the pet renderer with a fixed random value of 0.5 before
measuring either format, keeping the random resting entry disabled and idle
choices repeatable. Production animation randomness is unchanged.

Shared-rig authoring can point multiple mesh parts at the same texture path and
set `assetSize:[width,height]`. The writer embeds each resolved path once and
requires consistent dimensions. Mesh positions remain part-local; normalized
UVs address the shared atlas. Identity opacity groups may have an earlier
identity-group parent, useful for eyelids that mask independently aimed eyes.

`record.ts PACK OUTPUT SCENARIOS [24|30]` records full-resolution 648×702 PNG
sequences. A scenario is `{name,duration,initial,events?,frameValues?}`; initial
is a motion input, events are `{at,motion}` in seconds, and frameValues optionally
supplies typed inputs per output frame. Synthetic dragVX/dragVY fields feed the
same spring integrator without becoming Rive contract inputs. The authored entry
state can condition on the initial motion to begin directly at its first frame.
With `RIVE_RECORD_RIG=/local/rig.json`, per-frame JSON also records every bone's
world matrix for deformation analysis. Procedural recordings use the production
spring/blink code and a deterministic RNG seed; production remains random. The
recording profile and all images remain under OUTPUT. Recordings advance at
fixed time steps independently of wall-clock throughput; use benchmark.mjs for
real-time CPU measurements.
