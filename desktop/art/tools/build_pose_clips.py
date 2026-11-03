#!/usr/bin/env python3
"""Turn generated pose sheets into a pet pack with clips.

Usage: build_pose_clips.py PLAN.json SHEET [SHEET...] OUT_DIR [--zip OUT.zip]

The sheets are grids of poses on flat #00FF00 or real transparency, keyed and sliced by
../moe/build_atlas.py (4 columns by 3 rows unless PLAN.json has "grid": [4, 2], and "grids" can
give one sheet its own, by the sheet file name's first letter). A clip is a list of beats, each
holding or moving a pose, with frames tweened along the optical flow between beats, so a few
drawings play as continuous motion (needs opencv-python-headless):

  {"pose": "idle", "frames": 30, "breathe": 1, "bob": 2, "rot": 1.5, "dy": 0, "sway": 1, "face": "blink"}

"face" paints only the face of another pose onto this one. Two drawings of one pose still differ
in every strand, so swapping the whole picture for a blink makes everything twitch. "fade": n sets
how many of that beat's frames travel from the last beat. PLAN.json's "faceBox" is [x0, y0, x1, y1]
as fractions of the frame.

Every pose is scaled so its head is the same size as the first pose's, and shifted so the heads line
up across each action, since a character whose head changes size between poses reads as a mistake.
PLAN.json's "farther" is for a pose whose head can't be measured or that is seen from further away,
such as lying down: pose name to its head size as a fraction of the first pose's.

With "effects": true, separate marks in a cell are kept rather than treated as residue. With "wind": 1 in PLAN.json, hair and veil away from the body sway all the time, so she never
stands still as a picture. "width" and "height" set the frame size, and "sizeScale" how large she
shows. PLAN.json holds the manifest fields, "poses" (the name of each pose in sheet order),
"clips" (name to beats) and "states" (state to clip names, or {"clip": name, "role": "intro"} for
one that plays once on entering or leaving the state). "still" names clips without wind. The 8×9 atlas, needed for the
thumbnail and any state without a clip, is sampled from the clips in "atlas".
"""
import argparse, importlib.util, json, math, sys, zipfile
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

FPS, COLUMNS, WIDTH, HEIGHT, FADE = 24, 12, 240, 260, 10
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


def match_heads(drawn, rows):
    """Sets each pose's `norm`, the scale that matches its head to the first pose's, and `nudge`, how
    far its head sits from the body's centre. Each row of a sheet is one action and shares the
    answer, so the head still moves within an action. A row with no head to find, such as lying
    down, takes the row before it."""
    import cv2
    first = drawn[0]
    x0, y0, x1, y1 = first['body']
    width = (x1 - x0) // 4
    head = on_grey(first['img'])[y0:y0 + (y1 - y0) // 4, x0 + width:x1 - width]
    measured = []
    for pose in drawn:
        page, best = on_grey(pose['img']), (-2, 1.0, 0.0)
        for size in np.arange(.75, 1.35, .01):
            resized = cv2.resize(page, None, fx=float(size), fy=float(size), interpolation=cv2.INTER_AREA)
            if resized.shape[0] < head.shape[0] or resized.shape[1] < head.shape[1]:
                continue
            _, score, _, at = cv2.minMaxLoc(cv2.matchTemplate(resized, head, cv2.TM_CCOEFF_NORMED))
            if score > best[0]:
                best = (score, float(size), (at[0] + head.shape[1] / 2) / size - (pose['body'][0] + pose['body'][2]) / 2)
        measured.append(best)
    previous = (1.0, 0.0)
    for row in sorted(set(rows)):
        members = [index for index, value in enumerate(rows) if value == row]
        found = [measured[index] for index in members if measured[index][0] >= .5]
        if found:
            previous = (float(np.median([item[1] for item in found])), float(np.median([item[2] for item in found])))
        for index in members:
            drawn[index]['norm'], drawn[index]['nudge'] = previous


def render(tools, pose, scale, args):
    size = scale * pose['norm']
    return tools.finish(tools.pose_canvas(pose, size, **{**args, 'dx': args['dx'] + (HEAD_X - pose['nudge']) * size}))


def beat_frames(tools, poses, scale, beat, cache):
    """Every frame of one beat. Motion is a whole number of cycles, so a beat ends where it began."""
    count, pose = beat['frames'], poses[beat['pose']]
    frames = []
    for index in range(count):
        phase = index / max(1, count - 1) * 2 * math.pi
        wave = math.sin(phase)
        arc = beat.get('arc', 0) * math.sin(index / max(1, count - 1) * math.pi)
        args = {
            'dy': beat.get('dy', 0) - abs(math.sin(phase)) * beat.get('bob', 0) - arc,
            'dx': math.sin(phase) * beat.get('sway', 0) + beat.get('dx', 0),
            'rot': wave * beat.get('rot', 0),
            'sy': 1 - (0.5 - 0.5 * math.cos(phase)) * 0.012 * beat.get('breathe', 0),
            'sx': 1 + (0.5 - 0.5 * math.cos(phase)) * 0.006 * beat.get('breathe', 0),
        }
        key = (beat['pose'], beat.get('face'), *(round(value, 2) for value in args.values()))
        if key not in cache:
            cache[key] = render(tools, pose, scale, args)
            if beat.get('face'):
                cache[key] = paint_face(cache[key], render(tools, poses[beat['face']], scale, args), FACE_BOX)
        frames.append(cache[key])
    return frames


def on_grey(frame):
    pixels = np.asarray(frame, dtype=np.float32)
    alpha = pixels[..., 3:] / 255
    return (pixels[..., :3] * alpha + 128 * (1 - alpha)).mean(-1).astype(np.uint8)


def tween(a, b, steps):
    """The frames between two drawings, each pushed part of the way along the optical flow, so a
    moving arm travels instead of fading out in one place and in at another."""
    import cv2
    flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    grey_a, grey_b = on_grey(a), on_grey(b)
    forward, backward = flow.calc(grey_a, grey_b, None), flow.calc(grey_b, grey_a, None)
    height, width = grey_a.shape
    y, x = np.mgrid[0:height, 0:width].astype(np.float32)
    def premultiplied(frame):
        pixels = np.asarray(frame, dtype=np.float32).copy()
        pixels[..., :3] *= pixels[..., 3:] / 255
        return pixels
    source_a, source_b = premultiplied(a), premultiplied(b)
    frames = []
    for step in range(1, steps + 1):
        amount = step / (steps + 1)
        # Ease in and out, so a move starts and stops gently.
        amount = amount * amount * (3 - 2 * amount)
        moved_a = cv2.remap(source_a, x - forward[..., 0] * amount, y - forward[..., 1] * amount, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        moved_b = cv2.remap(source_b, x - backward[..., 0] * (1 - amount), y - backward[..., 1] * (1 - amount), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        mixed = moved_a * (1 - amount) + moved_b * amount
        rgb = np.divide(mixed[..., :3] * 255, mixed[..., 3:], out=np.zeros_like(mixed[..., :3]), where=mixed[..., 3:] > 0)
        frames.append(Image.fromarray(np.clip(np.dstack([rgb, mixed[..., 3]]), 0, 255).round().astype(np.uint8), 'RGBA'))
    return frames


def clip_frames(tools, poses, scale, beats, cache):
    frames, previous = [], None
    for beat in beats:
        next_frames = beat_frames(tools, poses, scale, beat, cache)
        # Move from where the last beat stopped, within this beat's own time.
        steps = min(beat.get('fade', FADE), len(next_frames) - 1)
        same = previous and all(previous.get(key) == beat.get(key) for key in ('pose', 'face', 'dx', 'dy', 'breathe', 'sway', 'bob', 'rot', 'arc'))
        if frames and steps > 0 and not same:
            next_frames[:steps] = tween(frames[-1], next_frames[steps], steps)
        previous = beat
        frames.extend(next_frames)
    return frames


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('plan', type=Path); parser.add_argument('sheets', nargs='+', type=Path); parser.add_argument('out', type=Path)
    parser.add_argument('--zip', type=Path)
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    # Plans authored at 15 fps retain their duration when rendered at 24 fps.
    source_fps = plan.get('fps', 15)
    for beats in plan['clips'].values():
        for beat in beats:
            beat['frames'] = max(2, round(beat['frames'] * FPS / source_fps))
            if 'fade' in beat:
                beat['fade'] = max(1, round(beat['fade'] * FPS / source_fps))
    global WIDTH, HEIGHT, FACE_BOX, HEAD_X
    WIDTH, HEIGHT = plan.get('width', WIDTH), plan.get('height', HEIGHT)
    FACE_BOX = plan.get('faceBox', (.3, .05, .7, .25))
    grid = plan.get('grid', (4, 3))
    tools = load_atlas_tools()
    args.out.mkdir(parents=True, exist_ok=True)
    drawn, rows = [], []
    for number, sheet in enumerate(args.sheets):
        cols, down = plan.get('grids', {}).get(sheet.name[0], grid)
        for index, pose in enumerate(tools.slice_sheet(sheet, cols, down, chroma=True, effects=plan.get('effects', False))):
            drawn.append(pose); rows.append((number, index // cols))
    if len(drawn) != len(plan['poses']):
        raise SystemExit(f"{len(drawn)} poses drawn, {len(plan['poses'])} named")
    poses = dict(zip(plan['poses'], drawn))
    match_heads(drawn, rows)
    HEAD_X = drawn[0]['nudge']
    for name, amount in plan.get('farther', {}).items():
        poses[name]['norm'] = drawn[0]['norm'] * amount
        poses[name]['nudge'] = HEAD_X
    # One scale, the largest at which every pose still fits.
    used = {beat['pose'] for beats in plan['clips'].values() for beat in beats} | {beat['face'] for beats in plan['clips'].values() for beat in beats if beat.get('face')}
    scale = min(min((WIDTH - 8) / pose['img'].width, (tools.BASELINE - 4) / pose['img'].height) / pose['norm'] for name, pose in poses.items() if name in used)
    (args.out / 'clips').mkdir(parents=True, exist_ok=True)
    frames, cache = {}, {}
    entries = {state: [{'clip': entry} if isinstance(entry, str) else entry for entry in names] for state, names in plan['states'].items()}
    declared = {entry['clip'] for names in entries.values() for entry in names}
    for name, beats in plan['clips'].items():
        frames[name] = clip_frames(tools, poses, scale, beats, cache)
        # Whole cycles from phase zero, so every clip starts and ends on the same drift and they join.
        if plan.get('wind') and name not in plan.get('still', ()):
            cycles = max(1, round(len(frames[name]) / (FPS * 3)))
            frames[name] = [wind(frame, index / max(1, len(frames[name]) - 1) * cycles * 2 * math.pi, plan['wind']) for index, frame in enumerate(frames[name])]
        # A clip only the atlas samples stays out of the pack, which holds just what it declares.
        if name not in declared:
            continue
        sheet = Image.new('RGBA', (COLUMNS * WIDTH, math.ceil(len(frames[name]) / COLUMNS) * HEIGHT))
        for index, frame in enumerate(frames[name]):
            sheet.paste(frame, (index % COLUMNS * WIDTH, index // COLUMNS * HEIGHT))
        sheet.save(args.out / 'clips' / f'{name}.webp', 'WEBP', quality=86, alpha_quality=92, method=4)
    atlas = Image.new('RGBA', (8 * ATLAS_CELL[0], 9 * ATLAS_CELL[1]))
    for row, (state, count) in enumerate(ATLAS_ROWS):
        source = frames[plan['atlas'][state]]
        for column in range(count):
            atlas.paste(source[column * len(source) // count].resize(ATLAS_CELL, Image.LANCZOS), (column * ATLAS_CELL[0], row * ATLAS_CELL[1]))
    atlas.save(args.out / 'spritesheet.webp', 'WEBP', quality=88, alpha_quality=92, method=4)
    manifest = {key: plan[key] for key in plan if key not in ('poses', 'clips', 'states', 'atlas', 'grid', 'grids', 'farther', 'still', 'wind', 'width', 'height', 'sizeScale', 'effects', 'faceBox', 'fps', 'talk')}
    manifest.update({'spritesheetPath': 'spritesheet.webp', 'remoteCodex': {
        'faceBox': list(FACE_BOX),
        **({'sizeScale': plan['sizeScale']} if 'sizeScale' in plan else {}),
        'clipFormat': {'fps': FPS, 'columns': COLUMNS, 'width': WIDTH, 'height': HEIGHT},
        'clips': {state: [{'path': f"clips/{entry['clip']}.webp", 'frames': len(frames[entry['clip']]), **({'role': entry['role']} if 'role' in entry else {})} for entry in names] for state, names in entries.items()}}})
    if plan.get('talk'):
        # Face variants are complete native frames; callers composite only the edited face.
        talk_frames = [Image.open(args.plan.parent / path).convert('RGBA') for path in plan['talk']]
        if not 3 <= len(talk_frames) <= 8 or any(frame.size != (WIDTH, HEIGHT) for frame in talk_frames):
            raise SystemExit('talk needs 3–8 native-size frames ordered closed, half, open, optional open variants')
        sheet = Image.new('RGBA', (COLUMNS * WIDTH, HEIGHT))
        for index, frame in enumerate(talk_frames):
            sheet.paste(frame, (index * WIDTH, 0))
        sheet.save(args.out / 'clips' / 'talk.webp', 'WEBP', quality=86, alpha_quality=92, method=4)
        manifest['remoteCodex']['talk'] = {'path': 'clips/talk.webp', 'frames': len(talk_frames)}
    declared_files = list((args.out / 'clips').glob('*.webp'))
    if any(path.stat().st_size > 8 * 1024 * 1024 for path in declared_files) or sum(path.stat().st_size for path in declared_files) > 160 * 1024 * 1024:
        raise SystemExit('clip byte limits exceeded')
    if any(len(frames[name]) > 512 for name in declared):
        raise SystemExit('clip frame limit exceeded')
    (args.out / 'pet.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')
    if args.zip:
        with zipfile.ZipFile(args.zip, 'w', zipfile.ZIP_STORED) as bundle:
            for path in sorted(p for p in args.out.rglob('*') if p.is_file()):
                bundle.write(path, path.relative_to(args.out).as_posix())
    print('poses', len(drawn), 'clips', len(frames), 'scale', round(scale, 3), 'bytes', sum(f.stat().st_size for f in args.out.rglob('*') if f.is_file()))


if __name__ == '__main__':
    main()
