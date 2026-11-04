#!/usr/bin/env python3
"""Capture the deployed Web UI's six theme/mode combinations in the DEBUG shell."""
import argparse,json,os,pathlib,subprocess,time
p=argparse.ArgumentParser();p.add_argument('simulator');p.add_argument('--output',required=True);a=p.parse_args()
root=pathlib.Path(a.output);root.mkdir(parents=True,exist_ok=True)
env={**os.environ,'DEVELOPER_DIR':'/Applications/Xcode-beta.app/Contents/Developer'}
for pack in ['classic','plum-pocket','terminal']:
 for mode in ['light','dark']:
  subprocess.run(['xcrun','simctl','ui',a.simulator,'appearance',mode],env=env,check=True)
  steps=[{'name':'select-theme','script':f"localStorage.setItem('pockymoe-theme-preset',{json.dumps(pack)});localStorage.setItem('remote-codex-theme-mode',{json.dumps(mode)});setTimeout(()=>location.reload(),100);return true"},
   {'name':'theme-and-thread-ready','script':f"await new Promise(r=>setTimeout(r,300));return document.documentElement.dataset.themePreset==={json.dumps(pack)} && document.documentElement.dataset.themeEffective==={json.dumps(mode)} && !!document.querySelector('[contenteditable][aria-label=Prompt]')",'wait':True,'timeout':40},
   {'name':'theme-evidence','script':"await document.fonts.ready;return {pack:document.documentElement.dataset.themePreset,effective:document.documentElement.dataset.themeEffective,path:location.pathname,desktopFrame:!!document.querySelector('.desktop-window-frame'),desktopRail:!!document.querySelector('[data-desktop-surface] .matter-rail')}"}]
  stepfile=root/f'{pack}-{mode}-steps.json';stepfile.write_text(json.dumps(steps))
  subprocess.run(['python3','scripts/ios-debug-run.py',a.simulator,str(stepfile),'--output',str(root/f'{pack}-{mode}.json')],check=True,env=env)
  time.sleep(.3)
  subprocess.run(['xcrun','simctl','io',a.simulator,'screenshot',str(root/f'{pack}-{mode}.png')],env=env,check=True,stdout=subprocess.DEVNULL)
  print(f'{pack} {mode}: captured',flush=True)
