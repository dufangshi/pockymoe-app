import { RiveHitMask, type RiveHitMaskData } from './riveHitMask';
import { RiveRestRouter, riveExitAnimations, type RiveRouting } from './riveRouting';
import {
  RiveDissolveClock,
  validateDissolves,
  type DissolveSample,
  type RiveDissolves,
} from './riveDissolve';
import { RiveDissolveGL } from './riveDissolveGL';
import type { LinearAnimationInstance } from '@rive-app/webgl2-advanced';
import type { RiveMotions } from './riveMotion';
import { RIVE_DYNAMIC_INPUTS, RiveResponse, riveSourceTime, type RiveProcedural } from './riveDynamics';
import Rive, {
  type RiveCanvas,
  type File,
  type Artboard,
  type StateMachineInstance,
  type WrappedRenderer,
  type SMIInput,
} from '@rive-app/webgl2-advanced';
import wasmUrl from '@rive-app/webgl2-advanced/rive.wasm?url';
import fallbackUrl from '@rive-app/webgl2-advanced/rive_fallback.wasm?url';
export const RIVE_STATES = ['idle', 'running', 'waiting', 'failed', 'review', 'sleeping', 'resting'] as const;
export const RIVE_TRIGGERS = ['complete', 'fail', 'poke', 'dragStart', 'land', 'wave'] as const;
export const RIVE_INPUTS = {
  state: 'number',
  mouth: 'number',
  lookX: 'number',
  lookY: 'number',
  dragging: 'bool',
  dock: 'number',
  ...Object.fromEntries(RIVE_TRIGGERS.map((n) => [n, 'trigger'])),
};
export interface RivePack {
  path: 'pet.riv';
  artboard: string;
  stateMachine: string;
  viewModel?: string;
  motions?: RiveMotions;
  procedural?: RiveProcedural;
  routing?: RiveRouting;
  backing?: { width: number; height: number; scale: number };
  hitMask?: RiveHitMaskData;
  dissolves?: RiveDissolves;
}
let runtime: Promise<RiveCanvas> | undefined;
export function riveRuntime(): Promise<RiveCanvas> {
  return (runtime ??= Rive({
    locateFile: (file) => (file.includes('fallback') ? fallbackUrl : wasmUrl),
  }));
}
/** Owns WASM handles and drawing, without a high-level player or implicit rAF. */
export class RiveDrawer {
  readonly backend = 'webgl2';
  inputs = new Map<string, SMIInput>();
  private router?: RiveRestRouter;
  private dissolveClock?: RiveDissolveClock;
  private dissolve?: DissolveSample;
  private compositor?: RiveDissolveGL;
  private animations = new Map<string, LinearAnimationInstance>();
  private config?: RivePack;
  private hitMask?: RiveHitMask;
  get hitMotion(): number | null | undefined {
    if (!this.hitMask) return undefined;
    return this.route?.leaving || this.route?.reaction || this.dissolve?.local
      ? null
      : (this.route?.value ?? null);
  }
  /** Synchronous CPU lookup, independent of GPU readback and animation clocks. */
  contains(x: number, y: number): boolean {
    return this.hitMask
      ? this.hitMask.contains(x, y, this.hitMotion ?? undefined)
      : x >= 0 && y >= 0 && x < 1 && y < 1;
  }
  private motionSelected = false;
  private ready = false;
  private response = new RiveResponse();
  private applied?: {
    animation: string;
    time: number;
    exitMix: number;
    reaction?: string;
    sourcePose?: { animation: string; time: number };
  };
  route?: ReturnType<RiveRestRouter['step']>;
  seekMotion(value: number, seconds: number): void {
    if (this.dissolveClock) {
      this.dissolveClock.seek(value, seconds);
      return;
    }
    if (!this.router) throw new Error('Pack has no rest routing');
    this.router.seek(value, seconds);
  }
  advance(seconds: number): boolean {
    this.motionSelected = false;
    if (this.dissolveClock) {
      this.dissolve = this.dissolveClock.step(seconds);
      this.route = this.dissolve;
      const animation = this.animations.get(this.route.animation)!;
      animation.time = this.route.time;
      animation.apply(1);
    }
    if (this.router) {
      this.route = this.router.step(seconds);
      this.route.time = riveSourceTime(this.route.time);
      if (this.route.reaction) {
        // The material must follow the same continuous clock as the body animation.
        this.route.reaction.animation = this.router.reactionAnimationAt(this.route.time)!;
      }
      if (
        this.applied?.animation !== this.route.animation ||
        this.applied.time !== this.route.time ||
        this.applied.exitMix !== this.route.exitMix ||
        this.applied.reaction !== this.route.reaction?.animation ||
        this.applied.sourcePose?.animation !== this.route.sourcePose?.animation ||
        this.applied.sourcePose?.time !== this.route.sourcePose?.time
      ) {
        if (this.applied?.animation !== this.route.animation && this.config?.routing?.resetAnimation) {
          const reset = this.animations.get(this.config.routing.resetAnimation)!;
          reset.time = 0;
          reset.apply(1);
        }
        if (this.route.sourcePose) {
          const pose = this.animations.get(this.route.sourcePose.animation)!;
          pose.time = this.route.sourcePose.time;
          pose.apply(1);
        }
        const animation = this.animations.get(this.route.animation)!;
        animation.time = this.route.time;
        animation.apply(1);
        this.applied = {
          animation: this.route.animation,
          time: this.route.time,
          exitMix: this.route.exitMix,
          reaction: this.route.reaction?.animation,
          sourcePose: this.route.sourcePose,
        };
      }
      if (this.route.reaction) {
        const reaction = this.animations.get(this.route.reaction.animation)!;
        reaction.time = this.route.reaction.time;
        reaction.apply(1);
      }
    }
    if (this.config?.procedural?.response)
      this.inputs.get('response')!.value = this.response.step(seconds);
    const active = this.machine.advanceAndApply(seconds);
    if (this.router || this.dissolveClock) this.artboard.advance(0);
    return active || !!this.router || !!this.dissolveClock;
  }
  private disposed = false;
  alphaAt(pointer: { x: number; y: number }, suspended = false): number {
    return !suspended && this.contains(pointer.x / this.canvas.width, pointer.y / this.canvas.height) ? 255 : 0;
  }
  get needsHitDraw(): boolean {
    return false;
  }
  pollHit(): boolean {
    return false;
  }
  suspendHit(): void {
    // CPU masks have no queued GPU probe to cancel.
  }
  private constructor(
    readonly runtime: RiveCanvas,
    readonly file: File,
    readonly artboard: Artboard,
    readonly machine: StateMachineInstance,
    readonly renderer: WrappedRenderer,
    readonly canvas: HTMLCanvasElement,
    readonly gl: WebGL2RenderingContext,
    private readonly renderCanvas: HTMLCanvasElement = canvas,
  ) {}
  static async load(
    canvas: HTMLCanvasElement,
    bytes: Uint8Array,
    config: RivePack,
    initial: Record<string, number | boolean> = {},
  ): Promise<RiveDrawer> {
    if (config.dissolves) {
      if (!config.routing) throw new Error('Drawing dissolves require routing clips');
      validateDissolves(config.dissolves, config.routing);
    }
    const r = await riveRuntime(),
      file = await r.load(bytes, undefined, false);
    if (!file) throw new Error('Rive runtime rejected file');
    let artboard: Artboard | undefined,
      machine: StateMachineInstance | undefined,
      renderer: WrappedRenderer | undefined,
      drawer: RiveDrawer | undefined;
    try {
      artboard = file.artboardByName(config.artboard);
      if (!artboard) throw new Error(`Missing artboard: ${config.artboard}`);
      const definition = artboard.stateMachineByName(config.stateMachine);
      if (!definition) throw new Error(`Missing state machine: ${config.stateMachine}`);
      if (config.viewModel) throw new Error('This prototype uses state-machine inputs; omit viewModel');
      machine = new r.StateMachineInstance(definition, artboard);
      const renderCanvas = config.dissolves ? document.createElement('canvas') : canvas;
      renderCanvas.width = canvas.width;
      renderCanvas.height = canvas.height;
      renderer = r.makeRenderer(renderCanvas, false, config.backing ? { inkbleed: true } : undefined);
      const compositor = config.dissolves ? new RiveDissolveGL(canvas) : undefined;
      const gl = compositor?.gl ?? canvas.getContext('webgl2');
      if (!gl) throw new Error('WebGL2 unavailable');
      drawer = new RiveDrawer(r, file, artboard, machine, renderer, canvas, gl, renderCanvas);
      drawer.compositor = compositor;
      for (let i = 0; i < machine.inputCount(); i++) {
        const input = machine.input(i);
        if (drawer.inputs.has(input.name)) throw new Error(`Duplicate input ${input.name}`);
        drawer.inputs.set(
          input.name,
          input.type === r.SMIInput.number
            ? input.asNumber()
            : input.type === r.SMIInput.bool
              ? input.asBool()
              : input.asTrigger(),
        );
      }
      for (const [name, type] of Object.entries({
        ...RIVE_INPUTS,
        ...(config.motions ? { motion: 'number', motionStart: 'trigger' } : {}),
        ...(config.procedural ? Object.fromEntries(RIVE_DYNAMIC_INPUTS.map((n) => [n, 'number'])) : {}),
        ...(config.procedural?.eyeOpen ? { eyeOpen: 'number' } : {}),
        ...(config.procedural?.response ? { response: 'number' } : {}),
      })) {
        const input = drawer.inputs.get(name);
        if (!input || input.type !== r.SMIInput[type as 'number' | 'bool' | 'trigger'])
          throw new Error(`Missing or wrong-type pet contract input: ${name}`);
      }
      if (config.procedural && !artboard.rootBone(config.procedural.bodyBone))
        throw new Error(`Missing procedural body bone: ${config.procedural.bodyBone}`);
      drawer.config = config;
      drawer.hitMask = config.hitMask ? new RiveHitMask(config.hitMask) : undefined;
      if (config.routing) {
        for (const name of new Set([
          ...(config.routing.resetAnimation ? [config.routing.resetAnimation] : []),
          ...config.routing.clips.flatMap((clip) => [
            clip.animation,
            ...(clip.exitAnimation ? [clip.exitAnimation] : []),
            ...riveExitAnimations(clip),
          ]),
          ...(config.routing.reactions?.flatMap((r) => [
            r.animation,
            ...(r.drawings?.map((drawing) => drawing.animation) ?? []),
          ]) ?? []),
        ])) {
          const animation = artboard.animationByName(name);
          if (!animation) throw new Error(`Missing routed animation: ${name}`);
          if (!drawer.animations.has(name))
            drawer.animations.set(name, new r.LinearAnimationInstance(animation, artboard));
        }
        const initialMotion = Number(
          initial.motion ?? config.motions?.idle?.[0]?.value ?? config.routing.clips[0].value,
        );
        if (config.dissolves)
          drawer.dissolveClock = new RiveDissolveClock(config.routing, config.dissolves, initialMotion);
        else drawer.router = new RiveRestRouter(config.routing, initialMotion);
      }
      for (const [name, value] of Object.entries(initial)) drawer.set(name, value);
      drawer.draw(0);
      drawer.ready = true;
      return drawer;
    } catch (error) {
      if (drawer) drawer.dispose();
      else {
        renderer?.delete();
        machine?.delete();
        artboard?.delete();
        file.unref();
      }
      throw error;
    }
  }
  set(name: string, value: number | boolean): boolean {
    if (name === 'motion') this.motionSelected = true;
    const input = this.inputs.get(name);
    if (!input) throw new Error(`Missing input ${name}`);
    if (typeof value === 'number') value = Math.fround(value);
    if (input.value === value) return false;
    input.value = value;
    if (this.ready && (name === 'motion' || name === 'state')) this.response.request();
    if (this.router && name === 'motion') this.router.request(Number(value), false, this.route?.time);
    if (this.dissolveClock && name === 'motion') this.requestDissolve(Number(value));
    if (this.router && name === 'state' && !this.motionSelected) {
      const motion = this.config?.motions?.[RIVE_STATES[Number(value)]]?.[0];
      if (motion) this.router.request(motion.value, false, this.route?.time);
    }
    if (this.dissolveClock && name === 'state' && !this.motionSelected) {
      const motion = this.config?.motions?.[RIVE_STATES[Number(value)]]?.[0];
      if (motion) this.requestDissolve(motion.value);
    }
    return true;
  }
  fire(name: string): void {
    const input = this.inputs.get(name);
    if (!input) throw new Error(`Missing trigger ${name}`);
    input.fire();
    if (this.ready && (name === 'motionStart' || (RIVE_TRIGGERS as readonly string[]).includes(name)))
      this.response.request();
    if (this.router && name === 'motionStart')
      this.router.request(Number(this.inputs.get('motion')?.value), true, this.route?.time);
    if (this.dissolveClock && name === 'motionStart')
      this.requestDissolve(Number(this.inputs.get('motion')?.value), true);
    const mood = (
      {
        complete: 'jumping',
        fail: 'failed',
        poke: 'poked',
        dragStart: 'dragging',
        land: 'landing',
        wave: 'waving',
      } as Record<string, string>
    )[name];
    if ((this.router || this.dissolveClock) && mood && !this.motionSelected) {
      const beats = this.config?.motions?.[mood],
        current = Number(this.inputs.get('motion')?.value);
      if (beats?.length && !beats.some((b) => b.value === current)) {
        this.inputs.get('motion')!.value = beats[0].value;
        if (this.router) this.router.request(beats[0].value, false, this.route?.time);
        else this.requestDissolve(beats[0].value);
      }
    }
  }
  draw(seconds: number, pointer?: { x: number; y: number }): { active: boolean; alpha: number } {
    if (this.disposed) throw new Error('Rive drawer disposed');
    const active = this.advance(seconds);
    if (this.compositor && this.dissolve) this.drawDissolve(this.dissolve);
    else this.drawArtboard();
    if (pointer) this.alphaAt(pointer);
    return { active, alpha: pointer ? this.alphaAt(pointer) : 0 };
  }

  private requestDissolve(value: number, restart = false): void {
    if (!this.dissolveClock?.request(value, restart)) return;
    // Do not bake a transient eyelid/mouth into the retained state image.
    if (this.dissolve) this.drawDissolve(this.dissolve, true);
    this.compositor!.captureState();
  }

  private drawDissolve(sample: DissolveSample, hideOverlays = false): void {
    const compositor = this.compositor!;
    if (this.renderCanvas.width !== this.canvas.width || this.renderCanvas.height !== this.canvas.height) {
      this.renderCanvas.width = this.canvas.width;
      this.renderCanvas.height = this.canvas.height;
    }
    const hidden = hideOverlays || sample.overlaysHidden;
    const saved = new Map<string, number>();
    if (hidden) {
      for (const name of ['blink', 'mouth', 'eyeOpen']) {
        const input = this.inputs.get(name);
        if (input) {
          saved.set(name, Number(input.value));
          input.value = 0;
        }
      }
    }
    const apply = (time: number) => {
      const animation = this.animations.get(sample.animation)!;
      animation.time = time;
      animation.apply(1);
      this.machine.advanceAndApply(0);
      this.artboard.advance(0);
      this.drawArtboard();
    };
    if (sample.local) {
      apply(sample.local.from);
      compositor.upload(this.renderCanvas, 0);
    }
    apply(sample.time);
    compositor.upload(this.renderCanvas, 1);
    compositor.draw(sample.local?.mix ?? 1, sample.stateMix, sample.local?.regions ?? []);
    for (const [name, value] of saved) this.inputs.get(name)!.value = value;
    if (saved.size) {
      this.machine.advanceAndApply(0);
      this.artboard.advance(0);
    }
  }

  private drawArtboard(): void {
    const r = this.renderer;
    r.clear();
    r.save();
    r.align(
      this.runtime.Fit.contain,
      this.runtime.Alignment.center,
      { minX: 0, minY: 0, maxX: this.canvas.width, maxY: this.canvas.height },
      this.artboard.bounds,
    );
    this.artboard.draw(r);
    r.restore();
    r.flush();
    this.runtime.resolveAnimationFrame();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const a of this.animations.values()) a.delete();
    this.animations.clear();
    this.machine.delete();
    this.artboard.delete();
    this.file.unref();
    this.renderer.delete();
    this.compositor?.dispose();
    this.inputs.clear();
  }
}
