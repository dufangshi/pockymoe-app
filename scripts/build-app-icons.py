"""Derive native icon assets from the selected opaque generation (requires Pillow)."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'output/imagegen/paper-terminal.png'
with Image.open(source) as original:
    icon = original.convert('RGB')
    if icon.width != icon.height:
        raise ValueError('App icon must be square.')
    icon.resize((1024, 1024), Image.Resampling.LANCZOS).save(
        root / 'ios/RemoteCodex/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png')
    for density, size in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
        target = root / f'android/app/src/main/res/mipmap-{density}/ic_launcher.png'
        target.parent.mkdir(parents=True, exist_ok=True)
        icon.resize((size, size), Image.Resampling.LANCZOS).save(target)
