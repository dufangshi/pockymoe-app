import { RiveDrawer, RIVE_STATES, RIVE_TRIGGERS } from '../../../../src/pet/rive';
import { RiveDynamics } from '../../../../src/pet/riveDynamics';
let drawer: RiveDrawer;
let dynamics: RiveDynamics | undefined, bodyBone = '', eyeOpen = false;
function advance(seconds: number, values: Record<string, number | boolean> = {}): void {
  drawer.machine.advanceAndApply(seconds);
  if (!dynamics) return;
  if (eyeOpen) drawer.set('eyeOpen', Number(drawer.inputs.get('lookX')?.value) !== 0 || Number(drawer.inputs.get('lookY')?.value) !== 0 ? 1 : 0);
  // worldTransform is a borrowed runtime matrix; copy its numbers, never delete it.
  const m = drawer.artboard.rootBone(bodyBone).worldTransform();
  const inputs = dynamics.step(seconds,{x:m.tx,y:m.ty,angle:Math.atan2(m.xy,m.xx)},{x:Number(values.dragVX ?? 0),y:Number(values.dragVY ?? 0)});
  for(const [name,value] of Object.entries(inputs)) drawer.set(name,value);
  drawer.machine.advanceAndApply(0);
}
export const preview = {
  async load(bytes: number[] | string, config: Parameters<typeof RiveDrawer.load>[2], initial: Record<string, number | boolean> = {}) {
    drawer?.dispose(); drawer = await RiveDrawer.load(document.querySelector('canvas')!, typeof bytes === 'string' ? Uint8Array.from(atob(bytes), c => c.charCodeAt(0)) : new Uint8Array(bytes), config, initial);
    let seed = 0x1234abcd;
    dynamics = config.procedural ? new RiveDynamics(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;}) : undefined;
    bodyBone = config.procedural?.bodyBone ?? '';
    eyeOpen = !!config.procedural?.eyeOpen;
    return [...drawer.inputs.keys()];
  },
  render(state: number, frames: number, values: Record<string, number | boolean> = {}, trigger?: string) {
    drawer.set('state', state); for (const [name, value] of Object.entries(values)) drawer.set(name, value); if (trigger) drawer.fire(trigger);
    // Advance at runtime cadence for transitions/scripts, but rasterize only the requested frame.
    for (let i = 0; i < frames; i++) advance(1 / 60);
    drawer.draw(0);
    return drawer.canvas.toDataURL('image/png');
  },
  capture(seconds: number, values: Record<string,number|boolean>, trigger: string | undefined, bones: string[]) {
    for (const [name,value] of Object.entries(values)) if (!['dragVX','dragVY'].includes(name)) drawer.set(name,value);
    if (trigger) drawer.fire(trigger);
    const steps = Math.max(1,Math.ceil(seconds*120));
    for(let i=0;i<steps;i++) advance(seconds/steps,values);
    drawer.draw(0);
    const transforms = Object.fromEntries(bones.map(name=>{const m=drawer.artboard.transformComponent(name).worldTransform();return [name,[m.xx,m.xy,m.yx,m.yy,m.tx,m.ty]];}));
    return { data: drawer.canvas.toDataURL('image/png'), transforms };
  },
  resize(width: number, height: number) { drawer.canvas.width = width; drawer.canvas.height = height; },
  ready() {
    // Embedded images may finish decoding after load(). Probe at t=0 so waiting
    // for them cannot consume the first authored motion frames.
    drawer.draw(0);
    const canvas = document.createElement('canvas'); canvas.width=drawer.canvas.width; canvas.height=drawer.canvas.height;
    const context=canvas.getContext('2d')!;context.drawImage(drawer.canvas,0,0);
    return context.getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>24);
  },
  async sheet(title: string, frames: { label: string; data: string }[]) {
    const canvas = document.createElement('canvas'), width = drawer.canvas.width, height = drawer.canvas.height; canvas.width = width * frames.length; canvas.height = height + 48;
    const c = canvas.getContext('2d')!; c.fillStyle = '#eef1f4'; c.fillRect(0, 0, canvas.width, canvas.height);
    c.font = '15px sans-serif'; c.fillStyle = '#202030'; c.fillText(title, 12, 20);
    for (let i = 0; i < frames.length; i++) {
      const im = new Image(); im.src = frames[i].data; await im.decode(); c.drawImage(im, i * width, 48);
      c.fillStyle = '#202030'; c.fillText(frames[i].label, i * width + 12, 42);
    }
    return canvas.toDataURL('image/png');
  },
  dispose() { drawer?.dispose(); }, states: RIVE_STATES, triggers: RIVE_TRIGGERS,
};
Object.assign(window, { preview });
