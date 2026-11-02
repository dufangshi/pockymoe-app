"""Rebuild assets with Pillow. The app icon is the current Pockymoe Web artwork.
Tray PNGs follow the original terminal vector geometry retained as SVG.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).resolve().parents[1]
build = root / 'build'
icon = Image.open(build / 'icon.png').convert('RGBA')
icon.save(build / 'icon.icns', format='ICNS')
icon.save(build / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
for state in ('none', 'running', 'attention'):
    dot = '' if state == 'none' else ('<circle cx="17" cy="14" r="2.4" fill="black"/>' if state == 'attention' else '<circle cx="17" cy="14" r="2.2" fill="none" stroke="black" stroke-width="1.3"/>')
    (build / f'tray-{state}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="22" height="18" viewBox="0 0 22 18"><path d="M3 4.5 7 8.5 3 12.5M10 12.5h4" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>{dot}</svg>')
    for scale in (1,2):
        s = 8
        image = Image.new('RGBA',(22*s,18*s)); d = ImageDraw.Draw(image)
        d.line([(3*s,4.5*s),(7*s,8.5*s),(3*s,12.5*s)],fill='black',width=round(1.6*s),joint='curve')
        d.line([(10*s,12.5*s),(14*s,12.5*s)],fill='black',width=round(1.6*s))
        if state != 'none':
            d.ellipse([14.5*s,11.5*s,19.5*s,16.5*s],fill='black')
            if state == 'running': d.ellipse([15.8*s,12.8*s,18.2*s,15.2*s],fill=(0,0,0,0))
        image = image.resize((22*scale,18*scale),Image.Resampling.LANCZOS)
        image.save(build / f'tray-{state}Template{"@2x" if scale == 2 else ""}.png')
        if scale == 2:
            win = Image.new('RGBA',(44,44)); win.alpha_composite(image,(0,4))
            win.save(build/f'tray-{state}.ico',sizes=[(16,16),(32,32),(44,44)])
            white = Image.new('RGBA',win.size,'white'); white.putalpha(win.getchannel('A'))
            white.save(build/f'tray-{state}-dark.ico',sizes=[(16,16),(32,32),(44,44)])
for state in ('attention','running'):
    for n in [*range(1,10),'many']:
        image = Image.new('RGBA',(128,128)); d=ImageDraw.Draw(image)
        color='#d99024' if state=='attention' else '#407ec9'
        if state == 'attention':
            d.rounded_rectangle((4,4,124,104),radius=24,fill=color)
            d.polygon([(72,96),(100,96),(100,126)],fill=color)
        else: d.ellipse((2,2,126,126),fill='#ffffff',outline=color,width=10)
        font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf',62 if n=='many' else 76)
        d.text((64,65),'9+' if n=='many' else str(n),anchor='mm',fill='#ffffff' if state=='attention' else color,font=font)
        image.resize((32,32),Image.Resampling.LANCZOS).save(build/f'overlay-{state}-{n}.png')
