#!/usr/bin/env python3
"""Isolated static Web, redirect and failure fixtures. Records no credential values."""
import argparse,http.server,json,mimetypes,pathlib,threading,urllib.parse
p=argparse.ArgumentParser();p.add_argument('--dist',required=True);p.add_argument('--web-port',type=int,default=28792);p.add_argument('--redirect-port',type=int,default=28794);p.add_argument('--bad-port',type=int,default=28793);a=p.parse_args()
root=pathlib.Path(a.dist).resolve()
stats={'redirects':0,'probeCredentials':0,'revocations':0,'revocationHadAuthorization':False,'revocationRedirectFollowed':False}
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def respond(self,status,body=b'',kind='text/plain',headers=None):
  self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)))
  for key,value in (headers or {}).items():self.send_header(key,value)
  self.end_headers();self.wfile.write(body)
 def do_GET(self):
  path=urllib.parse.urlparse(self.path).path
  if path=='/.debug/status':return self.respond(200,json.dumps(stats).encode(),'application/json')
  if self.server.server_port==a.redirect_port:
   stats['redirects']+=1
   if self.headers.get('Cookie') or self.headers.get('Authorization'):stats['probeCredentials']+=1
   return self.respond(307,headers={'Location':f'http://127.0.0.1:{a.web_port}/'})
  if self.server.server_port==a.bad_port:return self.respond(200,b'<html>Other application</html>','text/html')
  if path=='/revocation-must-not-follow':stats['revocationRedirectFollowed']=True
  target=(root/urllib.parse.unquote(path).lstrip('/')).resolve()
  if not target.is_relative_to(root):return self.respond(403)
  if not target.is_file():target=root/'index.html'
  self.respond(200,target.read_bytes(),mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
 def do_POST(self):
  path=urllib.parse.urlparse(self.path).path
  if self.server.server_port==a.redirect_port and path=='/relay/auth/logout':
   stats['revocations']+=1;stats['revocationHadAuthorization']=bool(self.headers.get('Authorization'))
   return self.respond(307,headers={'Location':f'http://127.0.0.1:{a.web_port}/revocation-must-not-follow'})
  self.respond(404)
servers=[]
for port in [a.web_port,a.redirect_port,a.bad_port]:
 server=http.server.ThreadingHTTPServer(('127.0.0.1',port),Handler);servers.append(server);threading.Thread(target=server.serve_forever,daemon=True).start()
print('Isolated review fixtures ready',flush=True)
try:threading.Event().wait()
except KeyboardInterrupt:pass
finally:
 for server in servers:server.shutdown()
