#!/usr/bin/env python3
"""Run an explicitly supplied DEBUG JavaScript step list; never print its contents."""
import argparse, json, os, pathlib, subprocess, time, uuid
p=argparse.ArgumentParser()
p.add_argument('simulator');p.add_argument('steps');p.add_argument('--output',required=True)
p.add_argument('--bundle',default='com.remotecodex.app')
p.add_argument('--expected-origin',help='Fail before any step if the page is not this isolated Web origin')
a=p.parse_args()
env={**os.environ,'DEVELOPER_DIR':'/Applications/Xcode-beta.app/Contents/Developer'}
def sim(*args): return subprocess.check_output(['xcrun','simctl',*args],env=env,text=True).strip()
container=pathlib.Path(sim('get_app_container',a.simulator,a.bundle,'data'))/'Documents'
container.mkdir(exist_ok=True)
result=container/'acceptance-results.json'
result.unlink(missing_ok=True)
steps=json.loads(pathlib.Path(a.steps).read_text())
if a.expected_origin:
    steps.insert(0, {'name':'expected-web-origin','script':"if(location.origin!=="+json.dumps(a.expected_origin)+")throw Error('Unexpected Web origin');return true"})
steps.insert(0, {'name':'web-root-ready','script':"return !!document.querySelector('#root')?.firstElementChild",'wait':True,'timeout':30})
run_id=str(uuid.uuid4())
steps[0]['name']='web-root-ready-'+run_id
(container/'acceptance.json').write_text(json.dumps(steps))
(container/'acceptance.json').chmod(0o600)
# The DEBUG file watcher also works when iOS asks for confirmation on openurl.
deadline=time.monotonic()+sum(step.get('timeout',30) for step in steps)+20
while True:
    if result.exists():
        data=json.loads(result.read_text())
        if data and data[0]['name']==steps[0]['name']: break
    if time.monotonic()>deadline: raise SystemExit('DEBUG harness did not finish')
    time.sleep(.25)
data[0]['name']='web-root-ready'
pathlib.Path(a.output).write_text(json.dumps(data,indent=2)+'\n')
for row in data: print(row['name']+': '+('PASS' if row['ok'] else 'FAIL'))
raise SystemExit(0 if len(data)==len(steps) and all(row['ok'] for row in data) else 1)
