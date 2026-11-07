import { createServer } from 'node:http';
/** Keep large embedded images out of the DevTools JSON protocol. Loopback only. */
export async function serveRiveBytes(bytes: Uint8Array): Promise<{ url: string; close: () => Promise<void> }> {
  const server=createServer((request,response)=>{
    if(request.method!=='GET'||request.url!=='/pet.riv'){response.writeHead(404);response.end();return;}
    response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.byteLength,'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});response.end(bytes);
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw new Error('Missing Rive preview address');
  return {url:`http://127.0.0.1:${address.port}/pet.riv`,close:()=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
