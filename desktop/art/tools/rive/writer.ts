import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import schema from './schema.json' with { type: 'json' };

type Value = number | string | boolean | Uint8Array;
type Props = Record<string, Value>;
export function varuint(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`Invalid uint32: ${value}`);
  const bytes: number[] = [];
  do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}
/** Keys and field types from MIT rive-runtime at schema.runtimeCommit. No editor dependency. */
export class RivWriter {
  chunks: Buffer[] = [Buffer.from('RIVE'), varuint(7), varuint(0), varuint(0), varuint(0)];
  object(name: keyof typeof schema.objects, props: Props = {}): void {
    const object = schema.objects[name];
    this.chunks.push(varuint(object.type));
    for (const [name, value] of Object.entries(props)) {
      const field = (object.props as Record<string, (number | string)[]>)[name];
      if (!field) throw new Error(`Unknown ${object.type}.${name}`);
      this.chunks.push(varuint(Number(field[0])));
      switch (field[1]) {
        case 'CoreDoubleType': {
          if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid float ${name}`);
          const b = Buffer.alloc(4); b.writeFloatLE(value); this.chunks.push(b); break;
        }
        case 'CoreStringType': { const b = Buffer.from(String(value)); this.chunks.push(varuint(b.length), b); break; }
        case 'CoreBytesType': {
          if (!(value instanceof Uint8Array)) throw new Error(`Expected bytes ${name}`);
          this.chunks.push(varuint(value.length), Buffer.from(value)); break;
        }
        case 'CoreBoolType': this.chunks.push(Buffer.from([value ? 1 : 0])); break;
        case 'CoreIdType': case 'CoreUintType': this.chunks.push(varuint(Number(value))); break;
        default: throw new Error(`Unsupported field type ${field[1]}`);
      }
    }
    this.chunks.push(varuint(0));
  }
  bytes(): Buffer { return Buffer.concat(this.chunks); }
}
export interface Bone { name: string; parent?: string; x?: number; y?: number; length: number; rotation?: number; offset?: boolean }
export interface Part {
  name: string; path: string; width: number; height: number; x: number; y: number;
  parent?: string; scaleX?: number; scaleY?: number; opacity?: number;
  mesh?: { vertices: [number, number, number, number][]; triangles: number[]; bones?: string[] };
}
export interface Track { target: string; property: string; keys: { frame: number; value: number; cubic?: [number, number, number, number] }[] }
export interface Rig {
  artboard: { name: string; width: number; height: number };
  bones: Bone[]; images: Part[];
  /** Identity-transform opacity groups, useful for pose sets with independent mouth layers. */
  groups?: { name: string; opacity?: number }[];
  animations: { name: string; fps?: number; duration: number; loop?: boolean; tracks: Track[] }[];
  stateMachine: { name: string; inputs: { name: string; type: 'number' | 'bool' | 'trigger'; value?: number | boolean }[];
    layers: { name: string; states: { name: string; animation?: string; kind?: 'entry' | 'any' | 'exit'; blend?: { input: string; animations: { animation: string; value: number }[] }; transitions?: { to: string; duration?: number; exitTime?: number; conditions?: { input: string; op?: number; value?: number | boolean }[] }[] }[] }[] };
}
/** Inverse-square distance to bone segments; largest-remainder byte weights sum to exactly 255. */
export function weights(x: number, y: number, bones: { x: number; y: number; endX: number; endY: number }[]): { indices: number; values: number } {
  if (!bones.length || bones.length > 255) throw new Error('Skin needs 1–255 bones');
  const nearest = bones.map((b, i) => {
    const dx = b.endX - b.x, dy = b.endY - b.y;
    const t = Math.max(0, Math.min(1, ((x - b.x) * dx + (y - b.y) * dy) / (dx * dx + dy * dy || 1)));
    return { i: i + 1, w: 1 / Math.max(1e-6, (x - b.x - t * dx) ** 2 + (y - b.y - t * dy) ** 2) };
  }).sort((a, b) => b.w - a.w).slice(0, 4);
  const sum = nearest.reduce((s, b) => s + b.w, 0), ws = nearest.map(b => Math.floor(b.w / sum * 255));
  const order = nearest.map((b, i) => ({ i, fraction: b.w / sum * 255 - ws[i] })).sort((a, b) => b.fraction - a.fraction);
  for (let n = 255 - ws.reduce((s, v) => s + v, 0), i = 0; i < n; i++) ws[order[i].i]++;
  return { indices: nearest.reduce((s, b, i) => (s | b.i << (i * 8)) >>> 0, 0), values: ws.reduce((s, w, i) => (s | w << (i * 8)) >>> 0, 0) };
}
export function buildRig(rig: Rig, base: string): Buffer {
  const w = new RivWriter(), ids = new Map<string, number>(), types = new Map<string, keyof typeof schema.objects>();
  let next = 1;
  const add = (type: keyof typeof schema.objects, name: string, props: Props): number => {
    if (ids.has(name)) throw new Error(`Duplicate object ${name}`);
    const id = next++; ids.set(name, id); types.set(name, type); w.object(type, props); return id;
  };
  const id = (name?: string): number => { if (!name) return 0; const n = ids.get(name); if (n === undefined) throw new Error(`Unknown object ${name}`); return n; };
  const index = (names: string[], name: string): number => { const i = names.indexOf(name); if (i < 0) throw new Error(`Unknown reference ${name}`); return i; };
  w.object('backboard');
  rig.images.forEach((part, i) => {
    w.object('image_asset', { name: part.name, assetId: i, width: part.width, height: part.height });
    w.object('file_asset_contents', { bytes: readFileSync(resolve(base, part.path)) });
  });
  w.object('artboard', { name: rig.artboard.name, width: rig.artboard.width, height: rig.artboard.height });
  for (const g of rig.groups ?? []) add('node', g.name, { name: g.name, opacity: g.opacity ?? 1, parentId: 0 });
  // Bind transforms use root bones or chains extending along their parent's +X axis.
  const binds = new Map<string, { x: number; y: number; angle: number; length: number }>();
  for (const bone of rig.bones) {
    const p = bone.parent ? binds.get(bone.parent) : undefined;
    if (bone.parent && !p) throw new Error(`Bone parents must precede children: ${bone.name}`);
    const angle = (p?.angle ?? 0) + (bone.rotation ?? 0);
    const x = p ? p.x + Math.cos(p.angle) * (bone.offset ? bone.x ?? 0 : p.length) - Math.sin(p.angle) * (bone.offset ? bone.y ?? 0 : 0) : bone.x ?? 0;
    const y = p ? p.y + Math.sin(p.angle) * (bone.offset ? bone.x ?? 0 : p.length) + Math.cos(p.angle) * (bone.offset ? bone.y ?? 0 : 0) : bone.y ?? 0;
    add(bone.parent && !bone.offset ? 'bone' : 'root_bone', bone.name, { name: bone.name, parentId: id(bone.parent), length: bone.length, rotation: bone.rotation ?? 0, ...(!bone.parent || bone.offset ? { x: bone.x ?? 0, y: bone.y ?? 0 } : {}) });
    binds.set(bone.name, { x, y, angle, length: bone.length });
  }
  rig.images.forEach((part, assetId) => {
    const image = add('image', part.name, { name: part.name, parentId: id(part.parent), assetId, x: part.x, y: part.y, scaleX: part.scaleX ?? 1, scaleY: part.scaleY ?? 1, opacity: part.opacity ?? 1 });
    if (!part.mesh) return;
    if (part.parent && !rig.groups?.some(g => g.name === part.parent) || (part.scaleX ?? 1) !== 1 || (part.scaleY ?? 1) !== 1) throw new Error('Mesh image must have an identity group parent and unit scale');
    const mesh = part.mesh;
    if (mesh.vertices.length < 3 || mesh.vertices.length > 65535 || mesh.vertices.some(v => v.length !== 4 || v.some(n => !Number.isFinite(n))) || mesh.triangles.length < 3 || mesh.triangles.length % 3 || mesh.triangles.some(i => !Number.isInteger(i) || i < 0 || i >= mesh.vertices.length)) throw new Error(`Invalid triangles ${part.name}`);
    const mid = add('mesh', `${part.name}.mesh`, { parentId: image, triangleIndexBytes: Buffer.concat(mesh.triangles.map(varuint)) });
    const bs = (mesh.bones ?? []).map(name => { const b = binds.get(name); if (!b) throw new Error(`Unknown bone ${name}`); return b; });
    mesh.vertices.forEach(([x, y, u, v], i) => {
      const vid = add('mesh_vertex', `${part.name}.v${i}`, { parentId: mid, x, y, u, v });
      if (bs.length) add('weight', `${part.name}.w${i}`, { parentId: vid, ...weights(x + part.x, y + part.y, bs.map(b => ({ ...b, endX: b.x + Math.cos(b.angle) * b.length, endY: b.y + Math.sin(b.angle) * b.length }))) });
    });
    if (bs.length) {
      const skin = add('skin', `${part.name}.skin`, { parentId: mid, tx: part.x, ty: part.y });
      bs.forEach((b, i) => add('tendon', `${part.name}.t${i}`, { parentId: skin, boneId: id(mesh.bones![i]), xx: Math.cos(b.angle), xy: Math.sin(b.angle), yx: -Math.sin(b.angle), yy: Math.cos(b.angle), tx: b.x, ty: b.y }));
    }
  });
  const curves = new Map<string, number>();
  for (const a of rig.animations) for (const t of a.tracks) for (const k of t.keys) if (k.cubic) {
    const key = JSON.stringify(k.cubic);
    if (!curves.has(key)) { const [x1, y1, x2, y2] = k.cubic; curves.set(key, add('cubic_ease_interpolator', `curve${curves.size}`, { x1, y1, x2, y2 })); }
  }
  for (const a of rig.animations) {
    w.object('linear_animation', { name: a.name, fps: a.fps ?? 60, duration: a.duration, loopValue: a.loop ? 1 : 0 });
    for (const t of a.tracks) {
      const type = types.get(t.target); if (!type) throw new Error(`Unknown track target ${t.target}`);
      const prop = (schema.objects[type].props as Record<string, (string | number)[]>)[t.property];
      if (!prop || prop[1] !== 'CoreDoubleType') throw new Error(`Not an animatable float: ${t.target}.${t.property}`);
      if (!t.keys.length || t.keys.some((k, i) => !Number.isInteger(k.frame) || k.frame < 0 || k.frame > a.duration || i > 0 && k.frame <= t.keys[i - 1].frame)) throw new Error(`Unordered/out-of-range keys ${a.name}`);
      w.object('keyed_object', { objectId: id(t.target) }); w.object('keyed_property', { propertyKey: Number(prop[0]) });
      for (const k of t.keys) w.object('keyframe_double', { frame: k.frame, value: k.value, interpolationType: k.cubic ? 2 : 1, interpolatorId: k.cubic ? curves.get(JSON.stringify(k.cubic))! : 0xffffffff });
    }
  }
  const sm = rig.stateMachine;
  w.object('state_machine', { name: sm.name });
  for (const input of sm.inputs) w.object(`state_machine_${input.type}`, { name: input.name, ...(input.type === 'trigger' ? {} : { value: input.value ?? (input.type === 'bool' ? false : 0) }) });
  for (const layer of sm.layers) {
    w.object('state_machine_layer', { name: layer.name });
    for (const state of layer.states) {
      if (state.kind) w.object(`${state.kind}_state`);
      else if (state.blend) {
        w.object('blend_state_1d_input', { inputId: index(sm.inputs.map(i => i.name), state.blend.input) });
        for (const a of state.blend.animations) w.object('blend_animation_1d', { animationId: index(rig.animations.map(a => a.name), a.animation), value: a.value });
      } else w.object('animation_state', { animationId: index(rig.animations.map(a => a.name), state.animation!) });
      for (const tr of state.transitions ?? []) {
        w.object('state_transition', { stateToId: index(layer.states.map(s => s.name), tr.to), duration: tr.duration ?? 0, ...(tr.exitTime === undefined ? {} : { flags: 4, exitTime: tr.exitTime }) });
        for (const c of tr.conditions ?? []) {
          const inputId = index(sm.inputs.map(i => i.name), c.input), input = sm.inputs[inputId];
          w.object(`transition_${input.type}_condition`, { inputId, ...(input.type === 'trigger' ? {} : { opValue: c.op ?? (c.value === false ? 1 : 0), ...(input.type === 'number' ? { value: Number(c.value) } : {}) }) });
        }
      }
    }
  }
  return w.bytes();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , source, output] = process.argv;
  if (!source || !output) throw new Error('Usage: node art/tools/rive/writer.ts rig.json pet.riv');
  const bytes = buildRig(JSON.parse(readFileSync(source, 'utf8')) as Rig, dirname(resolve(source)));
  writeFileSync(output, bytes); console.log(`${output}: ${bytes.length} bytes`);
}
