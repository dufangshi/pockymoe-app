import type { DissolveRect } from './riveDissolve';

const vertex = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const fragment = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D oldChart;
uniform sampler2D newChart;
uniform sampler2D previousState;
uniform float localMix;
uniform float stateMix;
uniform int regionCount;
uniform vec4 regions[64];
uniform vec2 feather;

// Inputs and output are premultiplied. Coverage is preserved independently of
// colour, preventing desktop/background fringes inside the opaque union.
vec4 dissolve(vec4 a, vec4 b, float t) {
  if (t <= 0.0) return a;
  if (t >= 1.0) return b;
  vec4 weighted = mix(a, b, t);
  float alpha = max(a.a, b.a);
  return vec4(weighted.rgb * alpha / max(weighted.a, 0.000001), alpha);
}
void main() {
  vec4 b = texture(newChart, uv);
  if (localMix < 1.0 && regionCount > 0) {
    vec2 p = vec2(uv.x, 1.0 - uv.y);
    float mask = 0.0;
    for (int i = 0; i < 64; i++) {
      if (i >= regionCount) break;
      vec4 r = regions[i];
      vec2 edge = min(p - r.xy, r.zw - p);
      vec2 fade = smoothstep(vec2(0.0), feather, edge);
      mask = max(mask, min(fade.x, fade.y));
    }
    vec4 a = texture(oldChart, uv);
    b = mix(b, dissolve(a, b, localMix), mask);
  }
  color = stateMix < 1.0 ? dissolve(texture(previousState, uv), b, stateMix) : b;
}`;

/** GPU-only compositor. Hit testing continues to use the synchronous CPU mask. */
export class RiveDissolveGL {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private textures: WebGLTexture[] = [];
  private stateReady = false;
  private drawn = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      // Events arrive between animation frames; retain that exact visible sample.
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 dissolve compositor unavailable');
    this.gl = gl;
    const shaders = [this.shader(gl.VERTEX_SHADER, vertex), this.shader(gl.FRAGMENT_SHADER, fragment)];
    const program = gl.createProgram();
    if (!program) throw new Error('Cannot allocate dissolve program');
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`Cannot link dissolve shader: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    gl.useProgram(program);
    for (const [i, name] of ['oldChart', 'newChart', 'previousState'].entries()) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Cannot allocate dissolve texture');
      this.textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.uniform1i(gl.getUniformLocation(program, name), i);
    }
    gl.disable(gl.BLEND);
  }

  private shader(kind: number, source: string): WebGLShader {
    const gl = this.gl,
      shader = gl.createShader(kind);
    if (!shader) throw new Error('Cannot allocate dissolve shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(`Cannot compile dissolve shader: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  }

  captureState(): void {
    if (!this.drawn) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[2]);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, this.canvas.width, this.canvas.height, 0);
    this.stateReady = true;
  }

  upload(source: HTMLCanvasElement, slot: 0 | 1): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + slot);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[slot]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  draw(localMix: number, stateMix: number, regions: DissolveRect[]): void {
    const gl = this.gl,
      p = this.program;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(p);
    gl.uniform1f(gl.getUniformLocation(p, 'localMix'), localMix);
    gl.uniform1f(gl.getUniformLocation(p, 'stateMix'), this.stateReady ? stateMix : 1);
    gl.uniform1i(gl.getUniformLocation(p, 'regionCount'), regions.length);
    if (regions.length)
      gl.uniform4fv(gl.getUniformLocation(p, 'regions[0]'), new Float32Array(regions.flat()));
    gl.uniform2f(gl.getUniformLocation(p, 'feather'), 3 / 648, 3 / 702);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawn = true;
  }

  dispose(): void {
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.gl.deleteProgram(this.program);
  }
}
