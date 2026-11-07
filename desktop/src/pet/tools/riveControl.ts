/** Harness-only alias. Production builds never import this module or its URL overrides. */
import { RiveDrawer as ActualDrawer } from '../rive';
import { RiveHitReadback } from '../riveHit';
export * from '../rive';
export type RiveDrawer = ActualDrawer;
export const RiveDrawer = {
  async load(...args: Parameters<typeof ActualDrawer.load>): Promise<ActualDrawer> {
    const mode = new URLSearchParams(location.search).get('riveControl');
    if (mode !== 'quad') return ActualDrawer.load(args[0],args[1],args[2],args[3],mode === 'canvas' || mode === 'webgl2' ? mode : args[4]);
    // Keep the real source clock and spring inputs so the control follows the
    // same adaptive 24/60 Hz schedule. Replace only its GPU drawing.
    const actual = await ActualDrawer.load(args[0],args[1],args[2],args[3],'webgl2');
    const canvas = args[0], gl = canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,depth:true,stencil:true,preserveDrawingBuffer:false});
    if (!gl) throw new Error('Quad control requires WebGL2');
    const shader = (type: number, source: string): WebGLShader => { const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s) ?? 'Quad shader failed');return s; };
    const vs=shader(gl.VERTEX_SHADER,'#version 300 es\nin vec2 p;out vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}');
    const fs=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision mediump float;in vec2 uv;uniform sampler2D image;out vec4 c;void main(){c=texture(image,uv);}');
    const program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Quad link failed');
    const vao=gl.createVertexArray(),buffer=gl.createBuffer(),texture=gl.createTexture();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const attribute=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    // Original geometric fixture, native-art dimensions and substantial transparent area.
    const pixels=new Uint8Array(648*702*4);
    for(let y=0;y<702;y++)for(let x=0;x<648;x++){const i=(y*648+x)*4,a=((x-324)/250)**2+((y-351)/320)**2<1?230:0;pixels[i]=Math.round(a*(.65+x/648*.25));pixels[i+1]=Math.round(a*.7);pixels[i+2]=Math.round(a*.8);pixels[i+3]=a;}
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,648,702,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const hit=new RiveHitReadback(gl),dispose=actual.dispose.bind(actual);
    actual.alphaAt=(p,s=false)=>hit.alphaAt(p.x,p.y,canvas.width,canvas.height,s);
    Object.defineProperty(actual,'needsHitDraw',{get:()=>hit.needsDraw});
    actual.pollHit=()=>hit.poll(canvas.width,canvas.height);actual.suspendHit=()=>hit.suspend();
    actual.draw=(seconds,pointer)=>{
      const active=actual.advance(seconds);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);gl.bindVertexArray(vao);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(gl.getUniformLocation(program,'image'),0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.flush();actual.runtime.resolveAnimationFrame();
      if(pointer)actual.alphaAt(pointer);hit.issue();return {active,alpha:pointer?actual.alphaAt(pointer):0};
    };
    actual.dispose=()=>{hit.dispose();gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);gl.deleteTexture(texture);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);dispose();};
    canvas.dataset.control='quad';return actual;
  },
};
