#!/usr/bin/env python3
"""Exercise the native DEBUG connection probe, without XCTest or credential output."""
import argparse,json,os,pathlib,subprocess,time
p=argparse.ArgumentParser();p.add_argument('simulator');p.add_argument('--service',required=True);p.add_argument('--relay',default='');p.add_argument('--legacy',action='store_true');p.add_argument('--pair',action='store_true');p.add_argument('--legacy-token-fixture',action='store_true');p.add_argument('--output',required=True);a=p.parse_args()
env={k:v for k,v in os.environ.items() if not k.startswith('SIMCTL_CHILD_')};env['DEVELOPER_DIR']='/Applications/Xcode-beta.app/Contents/Developer'
def sim(*args):return subprocess.check_output(['xcrun','simctl',*args],env=env,text=True).strip()
container=pathlib.Path(sim('get_app_container',a.simulator,'com.remotecodex.app','data'))/'Documents';container.mkdir(exist_ok=True)
fixture={'service':a.service,'relay':a.relay,'legacy':a.legacy,'pair':a.pair}
if a.legacy_token_fixture:fixture['legacyToken']='fixture-session'
(container/'setup-fixture.json').write_text(json.dumps(fixture));(container/'setup-fixture.json').chmod(0o600)
result=container/'setup-result.json';result.unlink(missing_ok=True)
sim('launch','--terminate-running-process',a.simulator,'com.remotecodex.app','--debug-setup-fixture','--debug-harness')
deadline=time.monotonic()+35
while not result.exists():
 if time.monotonic()>deadline:raise SystemExit('Connection probe did not finish')
 time.sleep(.2)
data=json.loads(result.read_text());pathlib.Path(a.output).write_text(json.dumps(data,indent=2)+'\n')
print('Native setup result: '+('connected' if data['webOrigin'] else 'connection form with inline error'))
