#!/usr/bin/env python3
"""Capture real system surfaces of this app's DEBUG fixtures on a dedicated simulator."""
import argparse,json,os,pathlib,subprocess,time
p=argparse.ArgumentParser();p.add_argument('simulator');p.add_argument('--origin',required=True);p.add_argument('--output',required=True);a=p.parse_args()
root=pathlib.Path(a.output);root.mkdir(parents=True,exist_ok=True)
env={**os.environ,'DEVELOPER_DIR':'/Applications/Xcode-beta.app/Contents/Developer'}
def sim(*args,extra=None): return subprocess.check_output(['xcrun','simctl',*args],env={**env,**(extra or {})},text=True,stderr=subprocess.STDOUT).strip()
container=pathlib.Path(sim('get_app_container',a.simulator,'com.remotecodex.app','data'))/'Documents'
(container/'acceptance.json').unlink(missing_ok=True)
for mode in ['light','dark']:
 sim('ui',a.simulator,'appearance',mode)
 for state in ['running','waiting','failed','interrupted','overflow','completed']:
  for layout in ['compact','minimal']:
   try: sim('terminate',a.simulator,'com.remotecodex.app')
   except subprocess.CalledProcessError: pass
   status=container/'activity-debug.json';status.unlink(missing_ok=True)
   sim('launch','--terminate-running-process',a.simulator,'com.remotecodex.app','--uitesting','--debug-harness',extra={'SIMCTL_CHILD_E2E_RELAY_URL':a.origin,'SIMCTL_CHILD_E2E_ACTIVITY_STATE':'needsInput' if state=='waiting' else state,'SIMCTL_CHILD_E2E_ACTIVITY_MINIMAL':'1' if layout=='minimal' else '0'})
   deadline=time.monotonic()+25
   while not status.exists() and time.monotonic()<deadline: time.sleep(.2)
   if not status.exists(): raise SystemExit(f'Fixture did not finish: {mode} {state} {layout}')
   info=json.loads(status.read_text());(root/f'{mode}-{state}-{layout}.json').write_text(json.dumps(info,indent=2)+'\n')
   sim('launch',a.simulator,'com.apple.Preferences')
   time.sleep(2)
   sim('io',a.simulator,'screenshot',str(root/f'{mode}-{state}-{layout}.png'))
   print(f'{mode} {state} {layout}: captured; activities={len(info["activities"])}',flush=True)
