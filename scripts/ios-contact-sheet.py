#!/usr/bin/env python3
"""Contact sheet of ImageRenderer outputs, explicitly separate from OS screenshots."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import argparse
p=argparse.ArgumentParser();p.add_argument('directory');p.add_argument('output');a=p.parse_args()
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18)
small=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',13)
layouts=['compact','minimal','expanded','lock-screen'];states=['running','waiting','failed','interrupted','overflow','completed']
cellw,cellh=310,190
sheet=Image.new('RGB',(cellw*8,cellh*6+80),'#e3e3e3');d=ImageDraw.Draw(sheet)
d.text((16,10),'SwiftUI ImageRenderer — design review renders, not SpringBoard screenshots',font=font,fill='black')
for row,state in enumerate(states):
 for col,(mode,layout) in enumerate((m,l) for m in ['light','dark'] for l in layouts):
  x,y=col*cellw,row*cellh+70
  d.rectangle((x+3,y+3,x+cellw-3,y+cellh-3),fill='#f5f5f5' if mode=='light' else '#2b2b2b')
  d.text((x+10,y+9),f'{state} · {mode} · {layout}',font=small,fill='black' if mode=='light' else 'white')
  im=Image.open(Path(a.directory)/f'{mode}-{state}-{layout}.png').convert('RGBA')
  im = im.resize((round(im.width / 4), round(im.height / 4)), Image.Resampling.LANCZOS)
  im.thumbnail((cellw-20,cellh-45))
  sheet.paste(im,(x+(cellw-im.width)//2,y+35+(cellh-45-im.height)//2),im)
sheet.save(a.output)
