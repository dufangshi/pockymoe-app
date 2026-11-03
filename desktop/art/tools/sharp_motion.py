"""Single-source flow with consistency rejection and a protected rigid head.
Never average two inconsistent moving limbs. Ambiguous transitions hold a key.
"""
import numpy as np
import cv2
from PIL import Image


def tween(a, b, steps, face):
    def grey(im):
        p = np.asarray(im, dtype=np.float32)
        return (p[..., :3] * p[..., 3:] / 255 + 128 * (1 - p[..., 3:] / 255)).mean(-1).astype('uint8')
    # Motion search on smaller images; only one high-resolution sampling pass.
    w, h = a.size
    small = (max(1, w // 2), max(1, h // 2))
    flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    ga, gb = cv2.resize(grey(a), small), cv2.resize(grey(b), small)
    f = cv2.resize(flow.calc(ga, gb, None), (w, h)) * 2
    r = cv2.resize(flow.calc(gb, ga, None), (w, h)) * 2
    y, x = np.mgrid[:h, :w].astype(np.float32)
    reverse_at_f = cv2.remap(r, x + f[..., 0], y + f[..., 1], cv2.INTER_LINEAR)
    inconsistent = np.linalg.norm(f + reverse_at_f, axis=-1) > 1.5
    opaque = (np.asarray(a)[..., 3] > 80) | (np.asarray(b)[..., 3] > 80)
    mismatch = (np.abs(grey(a).astype(float) - cv2.remap(grey(b), x + f[..., 0], y + f[..., 1], cv2.INTER_LINEAR).astype(float)) > 22) & opaque
    # Significant occlusion/large pose changes: a sharp held key beats invented anatomy.
    hold = float(np.mean((inconsistent | mismatch)[opaque])) > .18 if opaque.any() else True
    frames = []
    for i in range(1, steps + 1):
        t = i / (steps + 1); t = t * t * (3 - 2 * t)
        src = a if t < .5 else b
        if hold:
            frames.append(src.copy()); continue
        p = np.asarray(src, dtype=np.float32).copy(); p[..., :3] *= p[..., 3:] / 255
        displacement = f * t if t < .5 else r * (1 - t)
        moved = cv2.remap(p, x - displacement[..., 0], y - displacement[..., 1], cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT)
        # Low-confidence pixels use the nearest original key, never a blended ghost.
        bad = inconsistent | mismatch
        moved[bad] = p[bad]
        # The aligned crown, face, ornaments and upper hair remain an unwarped key.
        x0, y0, x1, y1 = face
        head = np.zeros((h, w), np.float32)
        head[max(0, int((y0 - .17) * h)):min(h, int((y1 + .09) * h)), max(0, int((x0 - .13) * w)):min(w, int((x1 + .13) * w))] = 1
        head = cv2.GaussianBlur(head, (0, 0), 2)[..., None]
        moved = moved * (1 - head) + p * head
        rgb = np.divide(moved[..., :3] * 255, moved[..., 3:], out=np.zeros_like(moved[..., :3]), where=moved[..., 3:] > 0)
        frames.append(Image.fromarray(np.clip(np.dstack([rgb, moved[..., 3]]), 0, 255).round().astype('uint8')))
    return frames


def transform(im, args):
    """All body transforms in one premultiplied affine sampling pass."""
    w, h = im.size
    m = cv2.getRotationMatrix2D((w / 2, h - 10), -args['rot'], 1)
    m[:, 0] *= args['sx']; m[:, 1] *= args['sy']
    m[0, 2] += args['dx']; m[1, 2] += args['dy']
    p = np.asarray(im, dtype=np.float32).copy(); p[..., :3] *= p[..., 3:] / 255
    p = cv2.warpAffine(p, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT)
    rgb = np.divide(p[..., :3] * 255, p[..., 3:], out=np.zeros_like(p[..., :3]), where=p[..., 3:] > 0)
    return Image.fromarray(np.clip(np.dstack([rgb, p[..., 3]]), 0, 255).round().astype('uint8'))
