#!/usr/bin/env python3
"""Turn generated pose sheets into a pet pack with clips.

Usage: build_pose_clips.py PLAN.json SHEET [SHEET...] OUT_DIR [--zip OUT.zip]

The sheets are grids of poses on flat #00FF00, keyed and sliced by ../moe/build_atlas.py
(4 columns by 3 rows unless PLAN.json has "grid": [4, 2]). A clip is a list of beats, each
holding or moving a pose, with a short crossfade between beats, so a few drawings play as
continuous motion:

  {"pose": "idle", "frames": 30, "breathe": 1, "bob": 2, "rot": 1.5, "dy": 0, "sway": 1, "face": "blink"}

"face" paints only the face of another pose onto this one. Two drawings of one pose still differ
in every strand, so swapping the whole picture for a blink makes everything twitch. "fade": n sets
that beat's crossfade length, and false cuts. PLAN.json's "faceBox" is [x0, y0, x1, y1] as fractions
of the frame.

With "effects": true, separate marks in a cell are kept rather than treated as residue. With "wind": 1 in PLAN.json, hair and veil away from the body sway all the time, so she never
stands still as a picture. "width" and "height" set the frame size, and "sizeScale" how large she
shows. PLAN.json holds the manifest fields, "poses" (the name of each pose in sheet order),
"clips" (name to beats) and "states" (state to clip names). The 8×9 atlas, needed for the
thumbnail and any state without a clip, is sampled from the clips in "atlas".
"""
import argparse, importlib.util, json, math, sys, zipfile
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

# Two drawings differ in every strand, so a long crossfade shows both of them at once.
FPS, COLUMNS, WIDTH, HEIGHT, FADE = 15, 12, 240, 260, 1
ATLAS_ROWS = [('idle', 6), ('running-right', 8), ('running-left', 8), ('waving', 4), ('jumping', 5), ('failed', 8), ('waiting', 6), ('running', 6), ('review', 6)]
ATLAS_CELL = (192, 208)


def load_atlas_tools():
    sys.dont_write_bytecode = True
    path = Path(__file__).resolve().parent.parent / 'moe' / 'build_atlas.py'
    spec = importlib.util.spec_from_file_location('build_atlas', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.CW, module.CH, module.SS, module.BASELINE = WIDTH, HEIGHT, 2, HEIGHT - 6
    return module


def wind(frame, phase, strength):
    """Hair and veil drift, growing toward the ends and the sides; face, body and feet stay put."""
    pixels = np.asarray(frame, dtype=np.float32)
    height, width = pixels.shape[:2]
    y, x = np.mgrid[0:height, 0:width].astype(np.float32)
    down = np.clip((y / height - .22) / .78, 0, 1) ** 1.5
    aside = np.clip(np.abs(x - width / 2) / (width * .22), 0, 1)
    drift = strength * width * .016 * np.sin(phase - y / height * 3.2) * down * aside
    # Premultiplied, so resampling doesn't pull dark fringes in from transparent pixels.
    alpha = pixels[..., 3:] / 255
    moved = [ndimage.map_coordinates(channel, [y, x - drift], order=1, mode='constant') for channel in np.moveaxis(np.dstack([pixels[..., :3] * alpha, pixels[..., 3]]), -1, 0)]
    rgb, a = np.dstack(moved[:3]), moved[3] / 255
    rgb = np.divide(rgb, a[..., None], out=np.zeros_like(rgb), where=a[..., None] > 0)
    return Image.fromarray(np.clip(np.dstack([rgb, moved[3]]), 0, 255).round().astype(np.uint8), 'RGBA')


def paint_face(frame, other, box):
    """Copies the face region of `other`, aligned to `frame` and feathered, so nothing else moves."""
    a, b = np.asarray(frame, dtype=np.float32), np.asarray(other, dtype=np.float32)
    height, width = a.shape[:2]
    x0, y0, x1, y1 = int(box[0] * width), int(box[1] * height), int(box[2] * width), int(box[3] * height)
    best, shift = None, (0, 0)
    for dy in range(-8, 9):
        for dx in range(-8, 9):
            moved = np.roll(b, (dy, dx), (0, 1))[y0:y1, x0:x1, :3].mean(-1)
            error = float(np.mean((moved - a[y0:y1, x0:x1, :3].mean(-1)) ** 2))
            if best is None or error < best:
                best, shift = error, (dy, dx)
    b = np.roll(b, shift, (0, 1))
    mask = np.zeros((height, width), dtype=np.float32)
    mask[y0:y1, x0:x1] = 1
    mask = ndimage.gaussian_filter(mask, (y1 - y0) / 8)[..., None]
    return Image.fromarray((a * (1 - mask) + b * mask).round().astype(np.uint8), 'RGBA')


def beat_frames(tools, poses, scale, beat, cache):
    """Every frame of one beat. Motion is a whole number of cycles, so a beat ends where it began."""
    count, pose = beat['frames'], poses[beat['pose']]
    frames = []
    for index in range(count):
        phase = index / count * 2 * math.pi
        wave = math.sin(phase)
        arc = beat.get('arc', 0) * math.sin(index / max(1, count - 1) * math.pi)
        args = {
            'dy': beat.get('dy', 0) - abs(math.sin(phase)) * beat.get('bob', 0) - arc,
            'dx': math.sin(phase) * beat.get('sway', 0),
            'rot': wave * beat.get('rot', 0),
            'sy': 1 - (0.5 + 0.5 * wave) * 0.012 * beat.get('breathe', 0),
            'sx': 1 + (0.5 + 0.5 * wave) * 0.006 * beat.get('breathe', 0),
        }
        key = (beat['pose'], beat.get('face'), *(round(value, 2) for value in args.values()))
        if key not in cache:
            cache[key] = tools.finish(tools.pose_canvas(pose, min(scale, pose['fit']), **args))
            if beat.get('face'):
                other = tools.finish(tools.pose_canvas(poses[beat['face']], min(scale, poses[beat['face']]['fit']), **args))
                cache[key] = paint_face(cache[key], other, FACE_BOX)
        frames.append(cache[key])
    return frames


def blend(a, b, amount):
    """A plain blend darkens edges with the black of transparent pixels, so mix premultiplied."""
    x, y = np.asarray(a, dtype=np.float32) / 255, np.asarray(b, dtype=np.float32) / 255
    alpha = x[..., 3:] * (1 - amount) + y[..., 3:] * amount
    rgb = x[..., :3] * x[..., 3:] * (1 - amount) + y[..., :3] * y[..., 3:] * amount
    rgb = np.divide(rgb, alpha, out=np.zeros_like(rgb), where=alpha > 0)
    return Image.fromarray((np.dstack([rgb, alpha]) * 255).round().astype(np.uint8), 'RGBA')


def clip_frames(tools, poses, scale, beats, cache):
    frames = []
    for beat in beats:
        next_frames = beat_frames(tools, poses, scale, beat, cache)
        # Crossfade from where the last beat stopped, unless both show the same drawing.
        fade = beat.get('fade', FADE)
        if frames and fade:
            last = frames[-1]
            for step in range(min(fade, len(next_frames))):
                next_frames[step] = blend(last, next_frames[step], (step + 1) / (fade + 1))
        frames.extend(next_frames)
    return frames


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('plan', type=Path); parser.add_argument('sheets', nargs='+', type=Path); parser.add_argument('out', type=Path)
    parser.add_argument('--zip', type=Path)
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    global WIDTH, HEIGHT, FACE_BOX
    WIDTH, HEIGHT = plan.get('width', WIDTH), plan.get('height', HEIGHT)
    FACE_BOX = plan.get('faceBox', (.3, .05, .7, .25))
    cols, rows = plan.get('grid', (4, 3))
    tools = load_atlas_tools()
    args.out.mkdir(parents=True, exist_ok=True)
    drawn = [pose for sheet in args.sheets for pose in tools.slice_sheet(sheet, cols, rows, chroma=True, effects=plan.get('effects', False))]
    if len(drawn) != len(plan['poses']):
        raise SystemExit(f"{len(drawn)} poses drawn, {len(plan['poses'])} named")
    poses = dict(zip(plan['poses'], drawn))
    # One scale, so she keeps her size between poses, set by what most poses allow. An unusually
    # wide pose such as sitting takes its own smaller scale, not everyone else's.
    for pose in drawn:
        pose['fit'] = min((WIDTH - 8) / pose['img'].width, (tools.BASELINE - 4) / pose['img'].height)
    scale = sorted(pose['fit'] for pose in drawn)[len(drawn) // 4]
    (args.out / 'clips').mkdir(parents=True, exist_ok=True)
    frames, cache = {}, {}
    for name, beats in plan['clips'].items():
        frames[name] = clip_frames(tools, poses, scale, beats, cache)
        # Whole cycles from phase zero, so every clip starts and ends on the same drift and they join.
        if plan.get('wind'):
            cycles = max(1, round(len(frames[name]) / (FPS * 3)))
            frames[name] = [wind(frame, index / len(frames[name]) * cycles * 2 * math.pi, plan['wind']) for index, frame in enumerate(frames[name])]
        # A clip only the atlas samples stays out of the pack, which holds just what it declares.
        if not any(name in names for names in plan['states'].values()):
            continue
        rows = math.ceil(len(frames[name]) / COLUMNS)
        sheet = Image.new('RGBA', (COLUMNS * WIDTH, rows * HEIGHT))
        for index, frame in enumerate(frames[name]):
            sheet.paste(frame, (index % COLUMNS * WIDTH, index // COLUMNS * HEIGHT))
        sheet.save(args.out / 'clips' / f'{name}.webp', 'WEBP', quality=86, alpha_quality=92, method=4)
    atlas = Image.new('RGBA', (8 * ATLAS_CELL[0], 9 * ATLAS_CELL[1]))
    for row, (state, count) in enumerate(ATLAS_ROWS):
        source = frames[plan['atlas'][state]]
        for column in range(count):
            atlas.paste(source[column * len(source) // count].resize(ATLAS_CELL, Image.LANCZOS), (column * ATLAS_CELL[0], row * ATLAS_CELL[1]))
    atlas.save(args.out / 'spritesheet.webp', 'WEBP', quality=88, alpha_quality=92, method=4)
    manifest = {key: plan[key] for key in plan if key not in ('poses', 'clips', 'states', 'atlas', 'grid', 'wind', 'width', 'height', 'sizeScale', 'effects', 'faceBox')}
    manifest.update({'spritesheetPath': 'spritesheet.webp', 'remoteCodex': {
        **({'sizeScale': plan['sizeScale']} if 'sizeScale' in plan else {}),
        'clipFormat': {'fps': FPS, 'columns': COLUMNS, 'width': WIDTH, 'height': HEIGHT},
        'clips': {state: [{'path': f'clips/{name}.webp', 'frames': len(frames[name])} for name in names] for state, names in plan['states'].items()}}})
    (args.out / 'pet.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')
    if args.zip:
        with zipfile.ZipFile(args.zip, 'w', zipfile.ZIP_STORED) as bundle:
            for path in sorted(p for p in args.out.rglob('*') if p.is_file()):
                bundle.write(path, path.relative_to(args.out).as_posix())
    print('poses', len(drawn), 'clips', len(frames), 'scale', round(scale, 3), 'bytes', sum(f.stat().st_size for f in args.out.rglob('*') if f.is_file()))


if __name__ == '__main__':
    main()
