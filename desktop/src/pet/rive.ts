import { RiveHitReadback, RiveCanvasHit } from './riveHit';
import type { RiveBackend } from './riveBackend';
import { RiveRestRouter, type RiveRouting } from './riveRouting';
import type { LinearAnimationInstance } from '@rive-app/webgl2-advanced';
import type { RiveMotions } from './riveMotion';
import { RIVE_DYNAMIC_INPUTS, riveSourceTime, type RiveProcedural } from './riveDynamics';
import Rive, { type RiveCanvas, type File, type Artboard, type StateMachineInstance, type WrappedRenderer, type SMIInput } from '@rive-app/webgl2-advanced';
import wasmUrl from '@rive-app/webgl2-advanced/rive.wasm?url';
import fallbackUrl from '@rive-app/webgl2-advanced/rive_fallback.wasm?url';
import CanvasRive from '@rive-app/canvas-advanced';
import canvasWasmUrl from '@rive-app/canvas-advanced/rive.wasm?url';
import canvasFallbackUrl from '@rive-app/canvas-advanced/rive_fallback.wasm?url';
export const RIVE_STATES = ['idle', 'running', 'waiting', 'failed', 'review', 'sleeping', 'resting'] as const;
export const RIVE_TRIGGERS = ['complete', 'fail', 'poke', 'dragStart', 'land', 'wave'] as const;
export const RIVE_INPUTS = { state: 'number', mouth: 'number', lookX: 'number', lookY: 'number', dragging: 'bool', dock: 'number', ...Object.fromEntries(RIVE_TRIGGERS.map(n => [n, 'trigger'])) };
export interface RivePack { path: 'pet.riv'; artboard: string; stateMachine: string; viewModel?: string; motions?: RiveMotions; procedural?: RiveProcedural; routing?: RiveRouting; backing?: { width: number; height: number; scale: number } }
const runtimes: Partial<Record<RiveBackend, Promise<RiveCanvas>>> = {};
export function riveRuntime(backend: RiveBackend = 'webgl2'): Promise<RiveCanvas> {
  return runtimes[backend] ??= backend === 'canvas' ? CanvasRive({ locateFile: file => file.includes('fallback') ? canvasFallbackUrl : canvasWasmUrl }) : Rive({ locateFile: file => file.includes('fallback') ? fallbackUrl : wasmUrl });
}
/** Owns WASM handles and drawing, without a high-level player or implicit rAF. */
export class RiveDrawer {
  inputs = new Map<string, SMIInput>();
  private router?: RiveRestRouter;
  private animations = new Map<string, LinearAnimationInstance>();
  private config?: RivePack;
  private motionSelected = false;
  private applied?: { animation: string; time: number; exitMix: number; reaction?: string };
  route?: ReturnType<RiveRestRouter['step']>;
  seekMotion(value: number, seconds: number): void { if (!this.router) throw new Error('Pack has no rest routing'); this.router.seek(value,seconds); }
  advance(seconds: number): boolean {
    this.motionSelected = false;
    if (this.router) {
      this.route = this.router.step(seconds);
      this.route.time = riveSourceTime(this.route.time,this.config?.procedural?.sourceFps,this.route.leaving);
      if (this.applied?.animation !== this.route.animation || this.applied.time !== this.route.time || this.applied.exitMix !== this.route.exitMix || this.applied.reaction !== this.route.reaction?.animation) {
        const animation = this.animations.get(this.route.animation)!; animation.time = this.route.time; animation.apply(1);
        const correction = this.config?.routing?.clips.find(c => c.value === this.route!.value)?.exitAnimation;
        if (this.route.leaving && correction) { const exit = this.animations.get(correction)!; exit.time = this.route.time; exit.apply(this.route.exitMix); }
        this.applied = { animation: this.route.animation, time: this.route.time, exitMix: this.route.exitMix, reaction: this.route.reaction?.animation };
      }
      if (this.route.reaction) { const reaction = this.animations.get(this.route.reaction.animation)!; reaction.time = this.route.reaction.time; reaction.apply(1); }
    }
    // An accelerated exit deliberately departs from its source face chart.
    // Transient overlays yield to source paint until the destination is safe.
    if (this.route?.leaving && this.config?.procedural?.transientFace) {
      for (const name of ['blink','mouth','eyeOpen','lookX','lookY']) this.inputs.get(name)!.value = 0;
    }
    const active = this.machine.advanceAndApply(seconds);
    if (this.router) this.artboard.advance(0);
    return active || !!this.router;
  }
  private disposed = false;
  private hitReadback: RiveHitReadback | RiveCanvasHit;
  alphaAt(pointer: { x: number; y: number }, suspended = false): number {
    return this.hitReadback.alphaAt(pointer.x, pointer.y, this.canvas.width, this.canvas.height, suspended);
  }
  get needsHitDraw(): boolean { return this.hitReadback.needsDraw; }
  pollHit(): boolean { return this.hitReadback.poll(this.canvas.width, this.canvas.height); }
  suspendHit(): void { this.hitReadback.suspend(); }
  private constructor(readonly runtime: RiveCanvas, readonly file: File, readonly artboard: Artboard, readonly machine: StateMachineInstance, readonly renderer: WrappedRenderer, readonly canvas: HTMLCanvasElement, readonly backend: RiveBackend, readonly gl?: WebGL2RenderingContext) { this.hitReadback = gl ? new RiveHitReadback(gl) : new RiveCanvasHit(canvas.getContext('2d')!); }
  static async load(canvas: HTMLCanvasElement, bytes: Uint8Array, config: RivePack, initial: Record<string, number | boolean> = {}, backend: RiveBackend = 'webgl2'): Promise<RiveDrawer> {
    const r = await riveRuntime(backend), file = await r.load(bytes, undefined, false);
    if (!file) throw new Error('Rive runtime rejected file');
    let artboard: Artboard | undefined, machine: StateMachineInstance | undefined, renderer: WrappedRenderer | undefined, drawer: RiveDrawer | undefined;
    try {
      artboard = file.artboardByName(config.artboard);
      if (!artboard) throw new Error(`Missing artboard: ${config.artboard}`);
      const definition = artboard.stateMachineByName(config.stateMachine);
      if (!definition) throw new Error(`Missing state machine: ${config.stateMachine}`);
      if (config.viewModel) throw new Error('This prototype uses state-machine inputs; omit viewModel');
      machine = new r.StateMachineInstance(definition, artboard);
      if (backend === 'canvas' && !canvas.getContext('2d', { willReadFrequently: true })) throw new Error('Canvas2D unavailable');
      renderer = r.makeRenderer(canvas, false, backend === 'webgl2' && config.backing ? { inkbleed: true } : undefined);
      const gl = backend === 'webgl2' ? canvas.getContext('webgl2') : undefined; if (backend === 'webgl2' && !gl) throw new Error('WebGL2 unavailable');
      drawer = new RiveDrawer(r, file, artboard, machine, renderer, canvas, backend, gl ?? undefined);
      for (let i = 0; i < machine.inputCount(); i++) { const input = machine.input(i); if (drawer.inputs.has(input.name)) throw new Error(`Duplicate input ${input.name}`); drawer.inputs.set(input.name, input.type === r.SMIInput.number ? input.asNumber() : input.type === r.SMIInput.bool ? input.asBool() : input.asTrigger()); }
      for (const [name, type] of Object.entries({ ...RIVE_INPUTS, ...(config.motions ? { motion: 'number', motionStart: 'trigger' } : {}), ...(config.procedural ? Object.fromEntries(RIVE_DYNAMIC_INPUTS.map(n => [n, 'number'])) : {}), ...(config.procedural?.eyeOpen ? { eyeOpen: 'number' } : {}) })) {
        const input = drawer.inputs.get(name);
        if (!input || input.type !== r.SMIInput[type as 'number' | 'bool' | 'trigger']) throw new Error(`Missing or wrong-type pet contract input: ${name}`);
      }
      if (config.procedural && !artboard.rootBone(config.procedural.bodyBone)) throw new Error(`Missing procedural body bone: ${config.procedural.bodyBone}`);
      drawer.config = config;
      if (config.routing) {
        for (const name of new Set([...config.routing.clips.flatMap(clip => [clip.animation,...(clip.exitAnimation ? [clip.exitAnimation] : [])]),...(config.routing.reactions?.map(r => r.animation) ?? [])])) {
          const animation = artboard.animationByName(name);
          if (!animation) throw new Error(`Missing routed animation: ${name}`);
          if (!drawer.animations.has(name)) drawer.animations.set(name,new r.LinearAnimationInstance(animation,artboard));
        }
        drawer.router = new RiveRestRouter(config.routing,Number(initial.motion ?? config.motions?.idle?.[0]?.value ?? config.routing.clips[0].value));
      }
      for (const [name,value] of Object.entries(initial)) drawer.set(name,value);
      drawer.draw(0); return drawer;
    } catch (error) { if (drawer) drawer.dispose(); else { renderer?.delete(); machine?.delete(); artboard?.delete(); file.unref(); } throw error; }
  }
  set(name: string, value: number | boolean): boolean {
    if (name === 'motion') this.motionSelected = true;
    const input = this.inputs.get(name); if (!input) throw new Error(`Missing input ${name}`);
    if (typeof value === 'number') value = Math.fround(value);
    if (input.value === value) return false; input.value = value;
    if (this.router && name === 'motion') this.router.request(Number(value),false,this.route?.time);
    if (this.router && name === 'state') { const motion = this.config?.motions?.[RIVE_STATES[Number(value)]]?.[0]; if (motion) this.router.request(motion.value,false,this.route?.time); }
    return true;
  }
  fire(name: string): void { const input = this.inputs.get(name); if (!input) throw new Error(`Missing trigger ${name}`); input.fire();
    if (this.router && name === 'motionStart') this.router.request(Number(this.inputs.get('motion')?.value),true,this.route?.time);
    const mood = ({complete:'jumping',fail:'failed',poke:'poked',dragStart:'dragging',land:'landing',wave:'waving'} as Record<string,string>)[name];
    if (this.router && mood && !this.motionSelected) {
      const beats=this.config?.motions?.[mood], current=Number(this.inputs.get('motion')?.value);
      if (beats?.length && !beats.some(b=>b.value===current)) { this.inputs.get('motion')!.value=beats[0].value; this.router.request(beats[0].value,false,this.route?.time); }
    }
  }
  draw(seconds: number, pointer?: { x: number; y: number }): { active: boolean; alpha: number } {
    if (this.disposed) throw new Error('Rive drawer disposed');
    const active = this.advance(seconds);
    const r = this.renderer; r.clear(); r.save();
    r.align(this.runtime.Fit.contain, this.runtime.Alignment.center, { minX: 0, minY: 0, maxX: this.canvas.width, maxY: this.canvas.height }, this.artboard.bounds);
    this.artboard.draw(r); r.restore(); r.flush(); this.runtime.resolveAnimationFrame();
    if (pointer) this.alphaAt(pointer);
    this.hitReadback.issue();
    return { active, alpha: pointer ? this.alphaAt(pointer) : 0 };
  }

  dispose(): void { if (this.disposed) return; this.disposed = true; this.hitReadback.dispose(); for (const a of this.animations.values()) a.delete(); this.animations.clear(); this.machine.delete(); this.artboard.delete(); this.file.unref(); this.renderer.delete(); this.inputs.clear(); }
}
