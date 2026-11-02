#!/usr/bin/env python3
"""Slice generated pose sheets and build a Codex-compatible pet atlas.

Usage: build_atlas.py SHEET1 SHEET2 OUT_DIR [--id ID --name NAME --description TEXT --chroma]
--chroma reads sheets drawn on flat #00FF00 and keys it out here: a character with white
hair loses its edge in a matte produced by the image model.
Atlas: 1536x1872, 8x9 cells of 192x208 (hatch-pet contract).
"""
import argparse, json, math
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

CW, CH = 192, 208
ROWS = [  # (name, frames)
    ('idle', 6), ('running-right', 8), ('running-left', 8), ('waving', 4), ('jumping', 5),
    ('failed', 8), ('waiting', 6), ('running', 6), ('review', 6)]
SS = 4            # supersampling factor for transforms
BASELINE = 196    # y of the feet inside a 208px cell
ALPHA_FLOOR = 24


def clean(im):
    a = np.array(im.convert('RGBA')).astype(np.float32)
    alpha = a[..., 3]
    alpha[alpha < ALPHA_FLOOR] = 0
    # Re-stretch remaining soft edge so outlines stay crisp after the floor cut.
    soft = (alpha > 0) & (alpha < 255)
    alpha[soft] = np.clip((alpha[soft] - ALPHA_FLOOR) * 255 / (255 - ALPHA_FLOOR), 0, 255)
    a[..., 3] = alpha
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def chroma_key(path):
    source = Image.open(path)
    # Answered with real transparency: keep that alpha, and only take out the green cast it
    # picked up. Keying it again over green leaves magenta fringes on anything sheer.
    if source.mode == 'RGBA' and source.getchannel('A').getextrema()[0] < 255:
        a = np.array(source).astype(np.float32)
        a[..., 1] = np.minimum(a[..., 1], np.maximum(a[..., 0], a[..., 2]))
        a[a[..., 3] <= 0] = 0
        return Image.fromarray(a.astype(np.uint8), 'RGBA')
    a = np.array(source.convert('RGB')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    excess = g - np.maximum(r, b)
    alpha = 1 - np.clip((excess - 40) / 90, 0, 1)
    # An edge pixel is a blend with the green behind it, so take that green back out.
    safe = np.maximum(alpha, 1e-3)
    bg = np.array([0, 255, 0], dtype=np.float32)
    fg = np.clip((a - (1 - alpha)[..., None] * bg) / safe[..., None], 0, 255)
    fg[..., 1] = np.minimum(fg[..., 1], np.maximum(fg[..., 0], fg[..., 2]) + 2)
    out = np.dstack([fg, alpha * 255])
    out[alpha <= 0] = 0
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def slice_sheet(path, cols=4, rows=3, chroma=False, effects=False):
    im = clean(chroma_key(path) if chroma else Image.open(path))
    alpha = np.array(im)[..., 3] > 0
    # A keyed sheet has no separate effects to gather up, and big hair can nearly touch the next pose.
    lab, n = ndimage.label(alpha if chroma else ndimage.binary_dilation(alpha, iterations=3))
    w, h = im.size
    cells = [[] for _ in range(cols * rows)]
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        ys, xs = sl
        area = (lab[sl] == i).sum()
        if area < 150:
            continue
        cy, cx = (ys.start + ys.stop) / 2, (xs.start + xs.stop) / 2
        idx = min(rows - 1, int(cy / (h / rows))) * cols + min(cols - 1, int(cx / (w / cols)))
        cells[idx].append((sl, i, area))
    poses = []
    for comps in cells:
        mask = np.zeros_like(alpha)
        # A keyed sheet has no effects outside the character, so anything apart from it is residue.
        for sl, i, _ in ([max(comps, key=lambda c: c[2])] if chroma and not effects else comps):
            mask[sl] |= (lab[sl] == i)
        mask &= alpha
        ys, xs = np.nonzero(mask)
        box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
        arr = np.array(im)
        arr[..., 3] = np.where(mask, arr[..., 3], 0)
        crop = Image.fromarray(arr).crop(box)
        # Main body = largest component; its bbox anchors centering and baseline.
        sl, i, _ = max(comps, key=lambda c: c[2])
        bys, bxs = np.nonzero((lab[sl] == i) & alpha[sl])
        body = (bxs.min() + sl[1].start - box[0], bys.min() + sl[0].start - box[1],
                bxs.max() + sl[1].start - box[0] + 1, bys.max() + sl[0].start - box[1] + 1)
        poses.append({'img': crop, 'body': body})
    return poses


def pose_canvas(p, scale, dx=0.0, dy=0.0, sx=1.0, sy=1.0, rot=0.0, mirror=False, glow=0.0):
    """Render one pose into a supersampled cell with feet on BASELINE."""
    img = p['img']
    if glow:
        img = gill_glow(img, glow)
    bx0, by0, bx1, by1 = p['body']
    s = scale * SS
    W, H = int(img.width * s * sx), int(img.height * s * sy)
    big = img.resize((max(1, W), max(1, H)), Image.LANCZOS)
    if mirror:
        big = big.transpose(Image.FLIP_LEFT_RIGHT)
        bx0, bx1 = img.width - bx1, img.width - bx0
    # anchor: body bottom-center
    ax, ay = (bx0 + bx1) / 2 * s * sx, by1 * s * sy
    if rot:
        pad = int(max(W, H) * 0.5)
        canvas = Image.new('RGBA', (W + 2 * pad, H + 2 * pad))
        canvas.alpha_composite(big, (pad, pad))
        big = canvas.rotate(rot, resample=Image.BICUBIC, center=(ax + pad, ay + pad))
        ax, ay = ax + pad, ay + pad
    cell = Image.new('RGBA', (CW * SS, CH * SS))
    x = int(round(CW * SS / 2 - ax + dx * SS))
    y = int(round(BASELINE * SS - ay + dy * SS))
    cell.alpha_composite(big, (x, y)) if x >= 0 and y >= 0 else paste_clipped(cell, big, x, y)
    return cell


def paste_clipped(cell, img, x, y):
    cx0, cy0 = max(0, -x), max(0, -y)
    img = img.crop((cx0, cy0, img.width, img.height))
    cell.alpha_composite(img, (max(0, x), max(0, y)))


def gill_glow(img, amount):
    a = np.array(img).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    amber = (r > 170) & (g > 110) & (b < 120) & (r > b + 80)
    for c, k in ((0, 0.25), (1, 0.55), (2, 0.15)):
        a[..., c] = np.where(amber, np.clip(a[..., c] + amount * 255 * k, 0, 255), a[..., c])
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def finish(cell):
    small = cell.resize((CW, CH), Image.LANCZOS)
    arr = np.array(small)
    arr[arr[..., 3] < 8] = 0  # fully transparent, no dirty RGB
    return Image.fromarray(arr, 'RGBA')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('sheet1'); parser.add_argument('sheet2'); parser.add_argument('out', type=Path)
    parser.add_argument('--id', default='moe'); parser.add_argument('--name', default='Moe')
    parser.add_argument('--description', default='A cobalt axolotl who keeps an eye on your Remote Codex threads.')
    parser.add_argument('--chroma', action='store_true')
    args = parser.parse_args()
    s1, s2, out = args.sheet1, args.sheet2, args.out
    A = slice_sheet(s1, chroma=args.chroma)   # idle, blink, content, look | walkA, walkB, wave1, wave2 | crouch, air, land, sleep
    B = slice_sheet(s2, chroma=args.chroma)   # type1, type2, focus, think | mag1, mag2, ask, hope | sad, slump, dizzy, surprised
    allp = A + B
    # One global scale: every pose (with props) must fit inside the cell with margin.
    scale = min(min((CW - 14) / p['img'].width, (BASELINE - 6) / p['img'].height) for p in allp)
    idle, blink, content, look, walkA, walkB, wave1, wave2, crouch, air, land, sleep = A
    type1, type2, focus, think, mag1, mag2, ask, hope, sad, slump, dizzy, surprised = B
    R = lambda p, **k: pose_canvas(p, scale, **k)
    # One pose per state with small motion only: these rows loop for a long time, and
    # jumping between different generated poses at 120-150 ms reads as flashing.
    rows = {
        'idle': [R(idle), R(idle, sy=0.992, sx=1.004), R(idle, sy=0.986, sx=1.007),
                 R(blink, sy=0.988, sx=1.006), R(idle, sy=0.992, sx=1.004), R(idle)],
        'running-right': [R(walkA, dy=-1), R(walkA, dy=-3), R(walkA, dy=-1), R(walkA),
                          R(walkB, dy=-1), R(walkB, dy=-3), R(walkB, dy=-1), R(walkB)],
        'waving': [R(wave1), R(wave1, rot=1.5), R(wave1), R(wave1, rot=-1.5)],
        'jumping': [R(content, sy=0.95, sx=1.03), R(content, dy=-10), R(content, dy=-16),
                    R(content, dy=-8), R(content, sy=0.97, sx=1.02)],
        'failed': [R(slump), R(slump, sy=0.994), R(slump, sy=0.988), R(slump, sy=0.984),
                   R(slump, sy=0.984), R(slump, sy=0.988), R(slump, sy=0.994), R(slump)],
        'waiting': [R(hope), R(hope, dy=-1), R(hope, dy=-2), R(hope, dy=-2), R(hope, dy=-1), R(hope)],
        # Both typing poses are nearly the same drawing, so this reads as work and not as flashing.
        'running': [R(type2, glow=0.02), R(type2, glow=0.05, dy=-1), R(type1, glow=0.08, dy=-2),
                    R(type1, glow=0.1, dy=-1), R(type2, glow=0.07, dy=-1), R(type1, glow=0.04)],
        'review': [R(mag2), R(mag2, rot=0.6), R(mag2, rot=1.2), R(mag2, rot=1.2), R(mag2, rot=0.6), R(mag2)],
    }
    rows['running-left'] = [R(p, dy=dy, mirror=True) for p, dy in
                            [(walkA, -1), (walkA, -3), (walkA, -1), (walkA, 0),
                             (walkB, -1), (walkB, -3), (walkB, -1), (walkB, 0)]]
    atlas = Image.new('RGBA', (CW * 8, CH * 9))
    for r, (name, count) in enumerate(ROWS):
        frames = rows[name]
        assert len(frames) == count, (name, len(frames))
        for c, f in enumerate(frames):
            atlas.alpha_composite(finish(f), (c * CW, r * CH))
    out.mkdir(parents=True, exist_ok=True)
    atlas.save(out / 'spritesheet.webp', 'WEBP', lossless=True, quality=100, method=6)
    atlas.save(out / 'spritesheet.png')
    # Sleeping strip (extension used by Remote Codex Desktop; ignored by Codex).
    sleep_frames = [R(sleep), R(sleep, sy=0.985, sx=1.01), R(sleep, sy=0.97, sx=1.02), R(sleep, sy=0.985)]
    strip = Image.new('RGBA', (CW * 4, CH))
    for c, f in enumerate(sleep_frames):
        strip.alpha_composite(finish(f), (c * CW, 0))
    strip.save(out / 'sleeping.webp', 'WEBP', lossless=True, quality=100, method=6)
    (out / 'pet.json').write_text(json.dumps({
        'id': args.id, 'displayName': args.name,
        'description': args.description,
        'spritesheetPath': 'spritesheet.webp',
        'remoteCodex': {'frameScale': 2.5, 'sleeping': {'path': 'sleeping.webp', 'frames': 4, 'durationsMs': [900, 700, 900, 700]}},
    }, indent=2, ensure_ascii=False) + '\n')
    print('scale', round(scale, 4), 'poses', len(allp))


if __name__ == '__main__':
    main()
