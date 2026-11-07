import type { RiveMotions } from './riveMotion';
import Rive, { type RiveCanvas, type File, type Artboard, type StateMachineInstance, type WrappedRenderer, type SMIInput } from '@rive-app/webgl2-advanced';
import wasmUrl from '@rive-app/webgl2-advanced/rive.wasm?url';
import fallbackUrl from '@rive-app/webgl2-advanced/rive_fallback.wasm?url';
export const RIVE_STATES = ['idle', 'running', 'waiting', 'failed', 'review', 'sleeping', 'resting'] as const;
export const RIVE_TRIGGERS = ['complete', 'fail', 'poke', 'dragStart', 'land', 'wave'] as const;
export const RIVE_INPUTS = { state: 'number', mouth: 'number', lookX: 'number', lookY: 'number', dragging: 'bool', dock: 'number', ...Object.fromEntries(RIVE_TRIGGERS.map(n => [n, 'trigger'])) };
export interface RivePack { path: 'pet.riv'; artboard: string; stateMachine: string; viewModel?: string; motions?: RiveMotions }
let runtime: Promise<RiveCanvas> | undefined;
export function riveRuntime(): Promise<RiveCanvas> { return runtime ??= Rive({ locateFile: file => file.includes('fallback') ? fallbackUrl : wasmUrl }); }
/** Owns WASM handles and drawing, without a high-level player or implicit rAF. */
export class RiveDrawer {
  inputs = new Map<string, SMIInput>();
  private disposed = false;
  private samplePoint?: { x: number; y: number };
  private sampled = { width: 0, height: 0, alpha: 0 };
  alphaAt(pointer: { x: number; y: number }): number {
    const same = this.samplePoint && Math.floor(pointer.x) === Math.floor(this.samplePoint.x) && Math.floor(pointer.y) === Math.floor(this.samplePoint.y);
    if (same && this.sampled.width === this.canvas.width && this.sampled.height === this.canvas.height) return this.sampled.alpha;
    return this.draw(0, pointer).alpha;
  }
  private constructor(readonly runtime: RiveCanvas, readonly file: File, readonly artboard: Artboard, readonly machine: StateMachineInstance, readonly renderer: WrappedRenderer, readonly canvas: HTMLCanvasElement, readonly gl: WebGL2RenderingContext) {}
  static async load(canvas: HTMLCanvasElement, bytes: Uint8Array, config: RivePack): Promise<RiveDrawer> {
    const r = await riveRuntime(), file = await r.load(bytes, undefined, false);
    if (!file) throw new Error('Rive runtime rejected file');
    let artboard: Artboard | undefined, machine: StateMachineInstance | undefined, renderer: WrappedRenderer | undefined;
    try {
      artboard = file.artboardByName(config.artboard);
      if (!artboard) throw new Error(`Missing artboard: ${config.artboard}`);
      const definition = artboard.stateMachineByName(config.stateMachine);
      if (!definition) throw new Error(`Missing state machine: ${config.stateMachine}`);
      if (config.viewModel) throw new Error('This prototype uses state-machine inputs; omit viewModel');
      machine = new r.StateMachineInstance(definition, artboard);
      renderer = r.makeRenderer(canvas, false);
      const gl = canvas.getContext('webgl2'); if (!gl) throw new Error('WebGL2 unavailable');
      const drawer = new RiveDrawer(r, file, artboard, machine, renderer, canvas, gl);
      for (let i = 0; i < machine.inputCount(); i++) { const input = machine.input(i); if (drawer.inputs.has(input.name)) throw new Error(`Duplicate input ${input.name}`); drawer.inputs.set(input.name, input.type === r.SMIInput.number ? input.asNumber() : input.type === r.SMIInput.bool ? input.asBool() : input.asTrigger()); }
      for (const [name, type] of Object.entries({ ...RIVE_INPUTS, ...(config.motions ? { motion: 'number', motionStart: 'trigger' } : {}) })) {
        const input = drawer.inputs.get(name);
        if (!input || input.type !== r.SMIInput[type as 'number' | 'bool' | 'trigger']) throw new Error(`Missing or wrong-type pet contract input: ${name}`);
      }
      drawer.draw(0); return drawer;
    } catch (error) { renderer?.delete(); machine?.delete(); artboard?.delete(); file.unref(); throw error; }
  }
  set(name: string, value: number | boolean): boolean {
    const input = this.inputs.get(name); if (!input) throw new Error(`Missing input ${name}`);
    if (typeof value === 'number') value = Math.fround(value);
    if (input.value === value) return false; input.value = value; return true;
  }
  fire(name: string): void { const input = this.inputs.get(name); if (!input) throw new Error(`Missing trigger ${name}`); input.fire(); }
  draw(seconds: number, pointer: { x: number; y: number } | undefined = this.samplePoint): { active: boolean; alpha: number } {
    if (this.disposed) throw new Error('Rive drawer disposed');
    const active = this.machine.advanceAndApply(seconds);
    const r = this.renderer; r.clear(); r.save();
    r.align(this.runtime.Fit.contain, this.runtime.Alignment.center, { minX: 0, minY: 0, maxX: this.canvas.width, maxY: this.canvas.height }, this.artboard.bounds);
    this.artboard.draw(r); r.restore(); r.flush(); this.runtime.resolveAnimationFrame();
    const inside = !!pointer && pointer.x >= 0 && pointer.y >= 0 && pointer.x < this.canvas.width && pointer.y < this.canvas.height;
    const pixel = new Uint8Array(4);
    // Always sample immediately after drawing; the default framebuffer may be discarded after this task.
    this.gl.readPixels(inside ? Math.floor(pointer!.x) : 0, inside ? this.canvas.height - 1 - Math.floor(pointer!.y) : 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    const alpha = inside ? pixel[3] : 0;
    this.samplePoint = pointer; this.sampled = { width: this.canvas.width, height: this.canvas.height, alpha };
    return { active, alpha };
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.machine.delete(); this.artboard.delete(); this.file.unref(); this.renderer.delete(); this.inputs.clear(); }
}
