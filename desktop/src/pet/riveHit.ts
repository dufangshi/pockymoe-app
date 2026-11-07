/** Sparse asynchronous alpha probes. Never wait for GPU completion on the UI thread. */
export class RiveHitReadback {
  private buffer: WebGLBuffer | null = null;
  private flight?: { fence: WebGLSync; x: number; y: number; width: number; height: number };
  private wanted?: { x: number; y: number; width: number; height: number };
  private last?: { x: number; y: number; width: number; height: number };
  private sampled?: { x: number; y: number; width: number; height: number; alpha: number };
  private issuedAt = -Infinity;
  constructor(private readonly gl: WebGL2RenderingContext, private readonly now: () => number = () => performance.now()) {}
  private same(a: { x: number; y: number; width: number; height: number } | undefined, b: { x: number; y: number; width: number; height: number }): boolean {
    return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }
  alphaAt(x: number, y: number, width: number, height: number, suspended = false): number {
    const point = { x: Math.floor(x), y: Math.floor(y), width, height };
    if (x < 0 || y < 0 || x >= width || y >= height) { this.wanted = undefined; this.last = undefined; return 0; }
    if (!suspended && !this.same(this.last, point)) { this.last = point; this.wanted = point; }
    return this.same(this.sampled, point) ? this.sampled!.alpha : 0;
  }
  get needsDraw(): boolean { return !!this.wanted && !this.flight && this.now() - this.issuedAt >= 100; }
  suspend(): void { this.wanted = undefined; this.last = undefined; }
  /** Called immediately after a draw while its default framebuffer is valid. */
  issue(): void {
    if (!this.needsDraw) return;
    const gl = this.gl, point = this.wanted!;
    this.wanted = undefined; this.issuedAt = this.now();
    this.buffer ??= gl.createBuffer(); if (!this.buffer) throw new Error('Cannot allocate Rive alpha probe');
    const previous = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, 4, gl.STREAM_READ);
    gl.readPixels(point.x, point.height - 1 - point.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previous);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) throw new Error('Cannot fence Rive alpha probe');
    this.flight = { ...point, fence }; gl.flush();
  }
  /** Poll with a zero timeout; getBufferSubData only after the fence is signalled. */
  poll(width: number, height: number): boolean {
    if (!this.flight) return false;
    const gl = this.gl, point = this.flight, status = gl.clientWaitSync(point.fence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return false;
    this.flight = undefined; gl.deleteSync(point.fence);
    if (status === gl.WAIT_FAILED || point.width !== width || point.height !== height) { this.last = undefined; return false; }
    const previous = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null, pixel = new Uint8Array(4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixel); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previous);
    this.sampled = { ...point, alpha: pixel[3] }; return true;
  }
  dispose(): void { if (this.flight) this.gl.deleteSync(this.flight.fence); if (this.buffer) this.gl.deleteBuffer(this.buffer); this.flight = undefined; this.buffer = null; this.wanted = undefined; }
}

/** Canvas2D's CPU pixel path is also demand-only and capped at 10Hz. */
export class RiveCanvasHit {
  private wanted?: { x: number; y: number; width: number; height: number };
  private last?: string;
  private sampled?: { key: string; alpha: number };
  private issuedAt = -Infinity;
  private changed = false;
  constructor(private readonly context: CanvasRenderingContext2D, private readonly now: () => number = () => performance.now()) {}
  alphaAt(x: number, y: number, width: number, height: number, suspended = false): number {
    if (x < 0 || y < 0 || x >= width || y >= height) { this.suspend(); return 0; }
    x = Math.floor(x); y = Math.floor(y);
    const key = `${x},${y},${width},${height}`;
    if (!suspended && key !== this.last) { this.last = key; this.wanted = { x, y, width, height }; }
    return this.sampled?.key === key ? this.sampled.alpha : 0;
  }
  get needsDraw(): boolean { return !!this.wanted && this.now() - this.issuedAt >= 100; }
  issue(): void {
    if (!this.needsDraw) return;
    const p = this.wanted!; this.wanted = undefined; this.issuedAt = this.now();
    this.sampled = { key: `${p.x},${p.y},${p.width},${p.height}`, alpha: this.context.getImageData(p.x, p.y, 1, 1).data[3] }; this.changed = true;
  }
  poll(width: number, height: number): boolean { if (this.sampled && !this.sampled.key.endsWith(`,${width},${height}`)) { this.sampled = undefined; this.changed = false; this.last = undefined; } const changed = this.changed; this.changed = false; return changed; }
  suspend(): void { this.wanted = undefined; this.last = undefined; }
  dispose(): void { this.suspend(); this.sampled = undefined; }
}
