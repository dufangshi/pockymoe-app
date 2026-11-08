"""Cut the single original LNZ sheet. Requires Pillow; no network calls."""

from pathlib import Path
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parent
im = Image.open(root / "source.png").convert("RGBA")
parts = [
    ("head", 0, 0, 106, 100),
    ("body", 1, 0, 82, 76),
    ("ear-left", 2, 0, 38, 45),
    ("ear-right", 3, 0, 38, 45),
    ("tail", 0, 1, 76, 88),
    ("eyes", 1, 1, 62, 28),
    ("eyes-closed", 2, 1, 62, 12),
    ("eyes-sleepy", 3, 1, 62, 16),
    ("mouth0", 0, 2, 18, 9),
    ("mouth1", 1, 2, 18, 12),
    ("mouth2", 2, 2, 22, 20),
    ("mouth3", 3, 2, 12, 15),
    ("paw-left", 0, 3, 23, 28),
    ("paw-right", 1, 3, 23, 28),
]
for name, col, row, w, h in parts:
    cell = im.crop(
        (
            round(col * im.width / 4),
            round(row * im.height / 4),
            round((col + 1) * im.width / 4),
            round((row + 1) * im.height / 4),
        )
    )
    alpha = cell.getchannel("A")
    # Remove the generator's faint exterior matte, fill pinholes, retain edge antialiasing.
    mask = (
        alpha.point(lambda a: 255 if a >= 170 else 0)
        .filter(ImageFilter.MaxFilter(5))
        .filter(ImageFilter.MinFilter(5))
    )
    box = mask.getbbox()
    if not box:
        raise ValueError(name)
    cell.putalpha(mask.filter(ImageFilter.GaussianBlur(0.45)))
    cell = cell.crop(box)
    cell.thumbnail((w, h), Image.Resampling.LANCZOS)
    cell.save(root / "parts" / (name + ".png"))
