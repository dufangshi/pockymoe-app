#!/usr/bin/env python3
"""Generate DEBUG acceptance steps from the disposable e2e-backend fixture.

No credentials are printed. Generated login input belongs in ignored .local/.
"""
import argparse,json,pathlib,urllib.parse,urllib.request
p=argparse.ArgumentParser()
p.add_argument('phase',choices=['login','protect','prepare-thread','thread','send','layout','settings-layout'])
p.add_argument('--env',default='.local/e2e-env.json');p.add_argument('--thread',default='.local/ios-debug-thread.json')
p.add_argument('--output',required=True);a=p.parse_args()
e=json.loads(pathlib.Path(a.env).read_text())
assert urllib.parse.urlparse(e['relayUrl']).hostname in ['127.0.0.1','localhost'], 'Use only an isolated loopback fixture'
def step(name,script,wait=False,timeout=30): return dict(name=name,script=script,wait=wait,timeout=timeout)
def quoted(value): return json.dumps(value)
if a.phase=='prepare-thread':
 body={'workspaceId':e['workspaceId'],'title':'iOS shell acceptance','provider':'acp','agentId':'codex','model':'ios-e2e-stream','approvalMode':'yolo'}
 request=urllib.request.Request(e['deviceApi']+'/threads/start',data=json.dumps(body).encode(),headers={'content-type':'application/json','authorization':'Bearer '+e['token']},method='POST')
 with urllib.request.urlopen(request) as response: result=json.load(response)
 thread=result.get('id') or result.get('thread',{}).get('id');assert thread
 path='/devices/'+e['deviceId']+'/threads/'+thread
 pathlib.Path(a.thread).write_text(json.dumps({'threadId':thread,'path':path}))
 steps=[step('fixture-created','return true')]
elif a.phase=='login':
 steps=[step('open-signin',"const b=[...document.querySelectorAll('button')].find(b=>/Sign in again|重新登录/.test(b.textContent));b?.click();return true"),step('login-form',"return !!document.querySelector('input[name=identifier]')",True),
  step('submit-password-login',"const set=(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));};set(document.querySelector('input[name=identifier]'),"+quoted(e['username'])+");set(document.querySelector('input[type=password]'),"+quoted(e['password'])+");await new Promise(r=>setTimeout(r,150));document.querySelector('form button[type=submit]').click();return true"),
  step('session-authenticated',"const s=await (await fetch("+quoted(e['relayUrl']+'/relay/auth/session')+",{credentials:'include'})).json();return s.authenticated===true",True,45),step('open-devices',"const link=document.querySelector('a[href=\"/relay-devices\"]');if(link)link.click();return true"),step('devices-loaded',"return location.pathname==='/relay-devices' && document.body.innerText.includes('e2e-phone')",True,45)]
elif a.phase=='settings-layout':
 steps=[step('open-settings', "window.pockymoeHost.window.openThread('/relay-settings');return true"),
  step('settings-safe-area-once', "const d=document.querySelector('.thread-graph-settings-dialog');if(!d)return false;const p=document.createElement('i');p.style.paddingTop='env(safe-area-inset-top)';document.body.append(p);const safe=parseFloat(getComputedStyle(p).paddingTop);p.remove();const title=d.querySelector('[data-slot=dialog-title]'),close=d.querySelector('[data-slot=dialog-close]');return Math.abs(parseFloat(getComputedStyle(d).paddingTop)-safe)<1 && title.getBoundingClientRect().top>=safe && close.getBoundingClientRect().top>=safe && d.getBoundingClientRect().height<=innerHeight+1",True)]
elif a.phase=='layout':
 steps=[step('keyboard-baseline', "document.activeElement?.blur();await new Promise(r=>setTimeout(r,500));window.__iosLayout={height:innerHeight,width:innerWidth};return scrollY===0 && visualViewport.offsetTop===0"),
  step('focus-composer', "document.querySelector('[contenteditable][aria-label=Prompt]').focus();return true"),
  step('keyboard-changes-only-visible-viewport', "const r=document.querySelector('[contenteditable][aria-label=Prompt]').getBoundingClientRect();return innerHeight===window.__iosLayout.height && innerWidth===window.__iosLayout.width && visualViewport.height<innerHeight-100 && visualViewport.offsetTop===0 && scrollY===0 && r.bottom<=visualViewport.height+1", True),
  step('close-keyboard', "document.activeElement.blur();return true"),
  step('keyboard-close-restores-viewport', "return innerHeight===window.__iosLayout.height && visualViewport.height===innerHeight && visualViewport.offsetTop===0 && scrollY===0", True)]
elif a.phase=='protect':
 steps=[step('protect-fixture',"if(document.querySelector('[aria-label=Protected]'))return true;[...document.querySelectorAll('button')].find(b=>b.textContent==='Later')?.click();[...document.querySelectorAll('button')].find(b=>b.textContent==='Protect all devices').click();await new Promise(r=>setTimeout(r,300));[...document.querySelectorAll('button')].find(b=>b.textContent==='Protect devices').click();return true"),step('fixture-protected',"return !!document.querySelector('[aria-label=Protected]')",True)]
else:
 t=json.loads(pathlib.Path(a.thread).read_text());route=t['path']
 if a.phase=='thread':
  steps=[step('open-thread',"window.pockymoeHost.window.openThread("+quoted(route)+");return true"),step('thread-composer',"return location.pathname==="+quoted(route)+" && !!document.querySelector('[contenteditable][aria-label=Prompt]')",True),step('mobile-surface',"const c=await window.pockymoeHost.capabilities();return c.surface==='mobile' && c.platform==='ios' && !document.querySelector('.desktop-window-frame,[data-desktop-surface] .matter-rail')",True)]
 else:
  prompt='iOS DEBUG acceptance message. Reply with hello.'
  api=e['deviceApi']+'/threads/'+t['threadId']
  steps=[step('send-through-web-composer',"const editor=document.querySelector('[contenteditable][aria-label=Prompt]');editor.focus();editor.textContent="+quoted(prompt)+";editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:"+quoted(prompt)+"}));await new Promise(r=>setTimeout(r,150));const send=document.querySelector('[aria-label=\"Send Prompt\"]');if(send.disabled)throw Error('Send disabled');send.click();return true"),step('message-visible-and-composer-cleared',"return document.body.innerText.includes("+quoted(prompt)+") && document.querySelector('[contenteditable][aria-label=Prompt]')?.textContent.trim()===''",True),step('persisted-completed-turn',"const r=await fetch("+quoted(api)+",{credentials:'include'});if(!r.ok)return false;const d=await r.json();return d.turns?.some(t=>t.status==='completed')===true && JSON.stringify(d.turns).includes("+quoted(prompt)+")",True,40)]
# Never submit disposable account credentials into a reused production page.
if a.phase == 'login':
 steps.insert(0, step('isolated-web-origin', 'if(location.origin!==' + quoted(e.get('webUrl', e['relayUrl'])) + ')throw Error(\'Expected isolated fixture origin\');return true'))
output=pathlib.Path(a.output);output.write_text(json.dumps(steps));output.chmod(0o600)
