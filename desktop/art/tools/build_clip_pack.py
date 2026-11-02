#!/usr/bin/env python3
"""Turn a folder of alpha WebM animations into a pet pack with clips.

Usage: build_clip_pack.py PLAN.json SOURCE_DIR OUT_DIR --ffmpeg PATH

PLAN.json holds the manifest fields and which video plays in which state:
  {"id": "...", "displayName": "...", "description": "...", "states": {"running": ["work02", "work04"], ...},
   "atlas": {"idle": "idle", "running-right": "move01right", ...}}

Clips play at 12 fps in 240×260 frames. The 8×9 atlas is still written, from evenly spaced
frames, for the thumbnail and for any state without a clip. Needs Pillow and an ffmpeg with
libvpx-vp9, whose decoder is the one that keeps the alpha channel.
"""
import argparse, glob, json, math, subprocess, tempfile
from pathlib import Path
from PIL import Image

FPS, COLUMNS, WIDTH, HEIGHT = 12, 12, 240, 260
ATLAS_ROWS = [('idle', 6), ('running-right', 8), ('running-left', 8), ('waving', 4), ('jumping', 5), ('failed', 8), ('waiting', 6), ('running', 6), ('review', 6)]
ATLAS_CELL = (192, 208)


def frames_of(ffmpeg, video, folder):
    # Crop the square video to the sprite window's shape, keeping the feet at the bottom.
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', str(video),
                    '-vf', f'fps={FPS},crop=iw*{WIDTH}/{HEIGHT}:ih,scale={WIDTH}:{HEIGHT}:flags=lanczos', '-vsync', '0', f'{folder}/%04d.png'], check=True)
    return sorted(glob.glob(f'{folder}/*.png'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('plan', type=Path); parser.add_argument('source', type=Path); parser.add_argument('out', type=Path)
    parser.add_argument('--ffmpeg', required=True)
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    (args.out / 'clips').mkdir(parents=True, exist_ok=True)
    frames, counts = {}, {}
    with tempfile.TemporaryDirectory() as work:
        names = {name for names in plan['states'].values() for name in names} | set(plan['atlas'].values())
        for name in sorted(names):
            folder = Path(work) / name; folder.mkdir()
            frames[name] = frames_of(args.ffmpeg, args.source / f'{name}.webm', folder)
            counts[name] = len(frames[name])
        for name in sorted({name for names in plan['states'].values() for name in names}):
            rows = math.ceil(counts[name] / COLUMNS)
            sheet = Image.new('RGBA', (COLUMNS * WIDTH, rows * HEIGHT))
            for index, path in enumerate(frames[name]):
                sheet.paste(Image.open(path).convert('RGBA'), (index % COLUMNS * WIDTH, index // COLUMNS * HEIGHT))
            sheet.save(args.out / 'clips' / f'{name}.webp', 'WEBP', quality=82, alpha_quality=90, method=4)
        atlas = Image.new('RGBA', (8 * ATLAS_CELL[0], 9 * ATLAS_CELL[1]))
        for row, (state, count) in enumerate(ATLAS_ROWS):
            source = frames[plan['atlas'][state]]
            for column in range(count):
                image = Image.open(source[column * len(source) // count]).convert('RGBA').resize(ATLAS_CELL, Image.LANCZOS)
                atlas.paste(image, (column * ATLAS_CELL[0], row * ATLAS_CELL[1]))
        atlas.save(args.out / 'spritesheet.webp', 'WEBP', quality=85, alpha_quality=90, method=4)
    manifest = {key: plan[key] for key in plan if key not in ('states', 'atlas')}
    manifest.update({'spritesheetPath': 'spritesheet.webp', 'remoteCodex': {
        'clipFormat': {'fps': FPS, 'columns': COLUMNS, 'width': WIDTH, 'height': HEIGHT},
        'clips': {state: [{'path': f'clips/{name}.webp', 'frames': counts[name]} for name in names] for state, names in plan['states'].items()}}})
    (args.out / 'pet.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')
    print('clips', len(list((args.out / 'clips').glob('*.webp'))), 'bytes', sum(f.stat().st_size for f in args.out.rglob('*') if f.is_file()))


if __name__ == '__main__':
    main()
