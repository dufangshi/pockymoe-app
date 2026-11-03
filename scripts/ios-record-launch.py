#!/usr/bin/env python3
"""Record a cold DEBUG launch and keep recording until scripted page readiness."""
import argparse,os,pathlib,signal,subprocess,time
p=argparse.ArgumentParser();p.add_argument('simulator');p.add_argument('--origin',required=True);p.add_argument('--relay');p.add_argument('--steps',required=True);p.add_argument('--output',required=True);a=p.parse_args()
env={k:v for k,v in os.environ.items() if not k.startswith('SIMCTL_CHILD_E2E_')}
env['DEVELOPER_DIR']='/Applications/Xcode-beta.app/Contents/Developer'
def sim(*args,extra=None): return subprocess.run(['xcrun','simctl',*args],env={**env,**(extra or {})},check=True,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
try: sim('terminate',a.simulator,'com.remotecodex.app')
except subprocess.CalledProcessError: pass
output=pathlib.Path(a.output);output.parent.mkdir(parents=True,exist_ok=True)
record=subprocess.Popen(['xcrun','simctl','io',a.simulator,'recordVideo','--codec=h264','--force',str(output)],env=env,stderr=subprocess.PIPE,stdout=subprocess.DEVNULL,text=True)
try:
 while True:
  line=record.stderr.readline()
  if 'Recording started' in line: break
  if not line: raise RuntimeError('Video recording did not start')
 sim('launch','--terminate-running-process',a.simulator,'com.remotecodex.app','--uitesting','--debug-harness',extra={'SIMCTL_CHILD_E2E_RELAY_URL':a.origin,'SIMCTL_CHILD_E2E_SEPARATE_RELAY_URL':a.relay or a.origin})
 subprocess.run(['python3','scripts/ios-debug-run.py',a.simulator,a.steps,'--output',str(output.with_suffix('.json'))],env=env,check=True)
 time.sleep(1)
finally:
 record.send_signal(signal.SIGINT);record.wait(timeout=20)
print('Cold launch recording saved: '+str(output))
