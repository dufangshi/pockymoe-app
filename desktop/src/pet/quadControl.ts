import type { RiveDrawer } from './rive';
import { RiveHitReadback } from './riveHit';

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const result = gl.createShader(type);
  if (!result) throw new Error('Cannot allocate quad shader');
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(result);
    gl.deleteShader(result);
    throw new Error(message ?? 'Quad shader failed');
  }
  return result;
}

/** Benchmark entry only: retain scene advancement and replace GPU drawing. */
export function useQuadDrawing(actual: RiveDrawer): RiveDrawer {
  const { canvas, gl } = actual;
  const vertex = shader(
    gl,
    gl.VERTEX_SHADER,
    `#version 300 es
    in vec2 p; out vec2 uv;
    void main() { uv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`,
  );
  const fragment = shader(
    gl,
    gl.FRAGMENT_SHADER,
    `#version 300 es
    precision mediump float; in vec2 uv; uniform sampler2D image; out vec4 c;
    void main() { c = texture(image, uv); }`,
  );
  const program = gl.createProgram();
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!program || !vao || !buffer || !texture) throw new Error('Cannot allocate quad resources');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Quad link failed');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const attribute = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Original geometric fixture; no character artwork in the application bundle.
  const pixels = new Uint8Array(648 * 702 * 4);
  for (let y = 0; y < 702; y++) {
    for (let x = 0; x < 648; x++) {
      const i = (y * 648 + x) * 4;
      const alpha = ((x - 324) / 250) ** 2 + ((y - 351) / 320) ** 2 < 1 ? 230 : 0;
      pixels[i] = Math.round(alpha * (0.65 + (x / 648) * 0.25));
      pixels[i + 1] = Math.round(alpha * 0.7);
      pixels[i + 2] = Math.round(alpha * 0.8);
      pixels[i + 3] = alpha;
    }
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 648, 702, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const uniform = gl.getUniformLocation(program, 'image');
  const hit = new RiveHitReadback(gl);
  const dispose = actual.dispose.bind(actual);
  actual.alphaAt = (point, suspended = false) =>
    hit.alphaAt(point.x, point.y, canvas.width, canvas.height, suspended);
  Object.defineProperty(actual, 'needsHitDraw', { get: () => hit.needsDraw });
  actual.pollHit = () => hit.poll(canvas.width, canvas.height);
  actual.suspendHit = () => hit.suspend();
  actual.draw = (seconds, pointer) => {
    const active = actual.advance(seconds);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    for (const capability of [gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.CULL_FACE, gl.BLEND]) {
      gl.disable(capability);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniform, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.flush();
    actual.runtime.resolveAnimationFrame();
    if (pointer) actual.alphaAt(pointer);
    hit.issue();
    return { active, alpha: pointer ? actual.alphaAt(pointer) : 0 };
  };
  actual.dispose = () => {
    hit.dispose();
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteTexture(texture);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    dispose();
  };
  canvas.dataset.control = 'quad';
  return actual;
}
