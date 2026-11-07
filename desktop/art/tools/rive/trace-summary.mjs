/** Chromium service events, not calls through the window's WebGL prototype. */
export function summarizeNativeTrace(events) {
 const reads=events.filter(e=>e.name==='GLES2::ReadPixels'&&(e.ph==='X'||e.ph==='B'));
 const draws=events.filter(e=>/^GLES2::Draw(Arrays|Elements)/.test(e.name)&&(e.ph==='X'||e.ph==='B'));
 const values=reads.filter(e=>e.ph==='X').map(e=>e.dur/1000).sort((a,b)=>a-b);
 return {readPixels:reads.length,drawCommands:draws.length,readPixelsDurationMs:values.reduce((a,b)=>a+b,0),meanReadPixelsMs:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,p95ReadPixelsMs:values.length?values[Math.min(values.length-1,Math.floor(values.length*.95))]:null,scope:'All GPU service processes in the isolated pet harness, including native presentation transfers; app pointer probes counted separately.'};
}
