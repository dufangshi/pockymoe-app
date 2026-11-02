#!/usr/bin/env python3
"""Turn generated pose sheets into a pet pack with clips.

Usage: build_pose_clips.py PLAN.json SHEET [SHEET...] OUT_DIR [--zip OUT.zip]

The sheets are grids of poses on flat #00FF00, 4 columns by 3 rows, keyed and sliced by
../moe/build_atlas.py. A clip is a list of beats, each holding or moving a pose, with a
short crossfade between beats, so a few drawings play as continuous motion:

  {"pose": "idle", "frames": 30, "breathe": 1, "bob": 2, "rot": 1.5, "dy": 0, "sway": 1}

PLAN.json holds the manifest fields, "poses" (the name of each pose in sheet order),
"clips" (name to beats) and "states" (state to clip names). The 8×9 atlas, needed for the
thumbnail and any state without a clip, is sampled from the clips in "atlas".
"""
import argparse, importlib.util, json, math, sys, zipfile
from pathlib import Path
import numpy as np
from PIL import Image

FPS, COLUMNS, WIDTH, HEIGHT, FADE = 15, 12, 240, 260, 2
ATLAS_ROWS = [('idle', 6), ('running-right', 8), ('running-left', 8), ('waving', 4), ('jumping', 5), ('failed', 8), ('waiting', 6), ('running', 6), ('review', 6)]
ATLAS_CELL = (192, 208)


def load_atlas_tools():
    sys.dont_write_bytecode = True
    path = Path(__file__).resolve().parent.parent / 'moe' / 'build_atlas.py'
    spec = importlib.util.spec_from_file_location('build_atlas', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.CW, module.CH, module.SS, module.BASELINE = WIDTH, HEIGHT, 2, HEIGHT - 8
    return module


def on_green(sheet, out):
    """The image model sometimes answers with real transparency; flatten that so every sheet is keyed alike."""
    image = Image.open(sheet)
    if image.mode != 'RGBA' or image.getchannel('A').getextrema()[0] == 255:
        return sheet
    flat = Image.new('RGBA', image.size, (0, 255, 0, 255))
    flat.alpha_composite(image)
    path = out.parent / f'{sheet.stem}.green.png'
    flat.convert('RGB').save(path)
    return path


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
        key = (beat['pose'], *(round(value, 2) for value in args.values()))
        if key not in cache:
            cache[key] = tools.finish(tools.pose_canvas(pose, scale, **args))
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
        if frames and beat.get('fade', True):
            last = frames[-1]
            for step in range(min(FADE, len(next_frames))):
                next_frames[step] = blend(last, next_frames[step], (step + 1) / (FADE + 1))
        frames.extend(next_frames)
    return frames


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('plan', type=Path); parser.add_argument('sheets', nargs='+', type=Path); parser.add_argument('out', type=Path)
    parser.add_argument('--zip', type=Path)
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    tools = load_atlas_tools()
    args.out.mkdir(parents=True, exist_ok=True)
    drawn = [pose for sheet in args.sheets for pose in tools.slice_sheet(on_green(sheet, args.out), chroma=True)]
    if len(drawn) != len(plan['poses']):
        raise SystemExit(f"{len(drawn)} poses drawn, {len(plan['poses'])} named")
    poses = dict(zip(plan['poses'], drawn))
    # One scale for all, so she never changes size between poses. Props and skirts must fit the cell.
    scale = min(min((WIDTH - 8) / pose['img'].width, (tools.BASELINE - 4) / pose['img'].height) for pose in drawn)
    (args.out / 'clips').mkdir(parents=True, exist_ok=True)
    frames, cache = {}, {}
    for name, beats in plan['clips'].items():
        frames[name] = clip_frames(tools, poses, scale, beats, cache)
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
    manifest = {key: plan[key] for key in plan if key not in ('poses', 'clips', 'states', 'atlas')}
    manifest.update({'spritesheetPath': 'spritesheet.webp', 'remoteCodex': {
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
