import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RiveDrawer, type RivePack } from './rive';

const fixture = vi.hoisted(() => {
  const applied: { name: string; time: number }[] = [];
  const noop = () => {};
  const types = { number: 1, bool: 2, trigger: 3 };
  const names = {
    number: [
      'state', 'mouth', 'lookX', 'lookY', 'dock', 'motion', 'response',
      'blink', 'breath', 'weightShift', 'swayHair', 'swayGown', 'swayWings', 'dragLean',
    ],
    bool: ['dragging'],
    trigger: ['complete', 'fail', 'poke', 'dragStart', 'land', 'wave', 'motionStart'],
  };
  class Machine {
    inputs = Object.entries(names).flatMap(([kind, names]) =>
      names.map((name) => ({
        name,
        type: types[kind as keyof typeof types],
        value: 0,
        asNumber() { return this; },
        asBool() { return this; },
        asTrigger() { return this; },
        fire: noop,
      })),
    );
    inputCount() {
      return this.inputs.length;
    }
    input(index: number) {
      return this.inputs[index];
    }
    advanceAndApply() {
      return false;
    }
    delete = noop;
  }
  class Animation {
    time = 0;
    constructor(readonly definition: { name: string }) {}
    apply() {
      applied.push({ name: this.definition.name, time: this.time });
    }
    delete = noop;
  }
  const artboard = {
    stateMachineByName: () => ({}),
    animationByName: (name: string) => ({ name }),
    advance: noop,
    draw: noop,
    delete: noop,
    bounds: {},
    rootBone: () => ({}),
  };
  const runtime = {
    SMIInput: types,
    StateMachineInstance: Machine,
    LinearAnimationInstance: Animation,
    load: async () => ({ artboardByName: () => artboard, unref: noop }),
    makeRenderer: () =>
      Object.fromEntries(
        ['clear', 'save', 'align', 'restore', 'flush', 'delete'].map((name) => [name, noop]),
      ),
    resolveAnimationFrame: noop,
    Fit: { contain: 0 },
    Alignment: { center: 0 },
  };
  return { applied, runtime };
});

vi.mock('@rive-app/webgl2-advanced', () => ({ default: async () => fixture.runtime }));

const config: RivePack = {
  path: 'pet.riv',
  artboard: 'Pet',
  stateMachine: 'Pet',
  motions: {
    idle: [{ value: 0, durationMs: 1000 }],
    running: [{ value: 1, durationMs: 1000 }],
    poked: [{ value: 2, durationMs: 1000 }],
    dragging: [{ value: 3, durationMs: 1000 }],
  },
  routing: {
    resetAnimation: 'neutral-properties',
    bridges: [],
    clips: ['idle', 'work', 'poke', 'drag'].map((animation, value) => ({
      value,
      animation,
      durationMs: 1000,
      start: 'rest',
      end: 'rest',
    })),
  },
};

async function workDrawer() {
  const canvas = { width: 100, height: 100, getContext: () => ({}) } as unknown as HTMLCanvasElement;
  return RiveDrawer.load(canvas, new Uint8Array(), structuredClone(config), { motion: 1, state: 1 });
}

describe('routed Rive application', () => {
  it('adds a press cue to an in-flight bank without restarting its drawing sequence', async () => {
    const pack = structuredClone(config);
    pack.procedural = { bodyBone: 'body', response: true };
    pack.routing!.clips[1].exits = {
      everyMs: 100, durationMs: 650, animationPrefix: 'exit-', sourcePose: true, end: 'rest',
    };
    const canvas = { width: 100, height: 100, getContext: () => ({}) } as unknown as HTMLCanvasElement;
    const drawer = await RiveDrawer.load(canvas, new Uint8Array(), pack, { motion: 1 });
    drawer.seekMotion(1, 0.3);
    drawer.advance(0);
    drawer.set('motion', 0);
    drawer.advance(0.2);
    expect(drawer.inputs.get('response')!.value).toBe(0);
    const bank = drawer.route!.animation;
    const time = drawer.route!.time;
    drawer.fire('dragStart');
    drawer.advance(1 / 60);
    expect(drawer.route!.animation).toBe(bank);
    expect(drawer.route!.time).toBeGreaterThan(time);
    expect(drawer.inputs.get('response')!.value).toBeGreaterThan(0);
    drawer.seekMotion(1, 0.3);
    drawer.advance(0);
    expect(drawer.inputs.get('response')!.value).toBe(0);
    drawer.dispose();
  });
  beforeEach(() => {
    fixture.applied.length = 0;
  });

  it.each([[2, 'poke'], [3, 'drag']] as const)(
    'keeps explicit motion %i when the renderer also reports coarse idle state',
    async (value, animation) => {
      const drawer = await workDrawer();
      drawer.set('motion', value);
      drawer.fire('motionStart');
      drawer.set('state', 0);
      drawer.fire(value === 2 ? 'poke' : 'dragStart');
      drawer.advance(2);
      drawer.advance(1 / 60);
      expect(drawer.route?.animation).toBe(animation);
      drawer.dispose();
    },
  );

  it('still routes state-only consumers after advancing the previous frame', async () => {
    const drawer = await workDrawer();
    drawer.advance(0);
    drawer.set('state', 0);
    drawer.advance(2);
    drawer.advance(1 / 60);
    expect(drawer.route?.animation).toBe('idle');
    drawer.dispose();
  });

  it('applies neutral properties before the held source pose and bank, without rendering the reset', async () => {
    const pack = structuredClone(config);
    pack.routing!.clips[1].exits = {
      everyMs: 100,
      durationMs: 650,
      animationPrefix: 'exit-',
      sourcePose: true,
      end: 'rest',
    };
    const canvas = { width: 100, height: 100, getContext: () => ({}) } as unknown as HTMLCanvasElement;
    const drawer = await RiveDrawer.load(canvas, new Uint8Array(), pack, { motion: 1, state: 1 });
    drawer.seekMotion(1, 0.35);
    drawer.advance(0);
    drawer.set('motion', 2);
    fixture.applied.length = 0;
    drawer.advance(0.06);
    expect(fixture.applied.map((item) => item.name)).toEqual(['neutral-properties', 'work', 'exit-4']);
    fixture.applied.length = 0;
    drawer.advance(0.65);
    expect(drawer.route).toMatchObject({ animation: 'poke', time: 0, leaving: false });
    expect(fixture.applied.map((item) => item.name)).toEqual(['neutral-properties', 'poke']);
    drawer.dispose();
  });
});
