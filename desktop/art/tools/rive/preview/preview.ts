import { RiveDrawer, RIVE_STATES, RIVE_TRIGGERS } from '../../../../src/pet/rive';
let drawer: RiveDrawer;
export const preview = {
  async load(bytes: number[] | string, config: Parameters<typeof RiveDrawer.load>[2]) {
    drawer?.dispose(); drawer = await RiveDrawer.load(document.querySelector('canvas')!, typeof bytes === 'string' ? Uint8Array.from(atob(bytes), c => c.charCodeAt(0)) : new Uint8Array(bytes), config);
    return [...drawer.inputs.keys()];
  },
  render(state: number, frames: number, values: Record<string, number | boolean> = {}, trigger?: string) {
    drawer.set('state', state); for (const [name, value] of Object.entries(values)) drawer.set(name, value); if (trigger) drawer.fire(trigger);
    // Advance at runtime cadence for transitions/scripts, but rasterize only the requested frame.
    for (let i = 1; i < frames; i++) drawer.machine.advanceAndApply(1 / 60);
    drawer.draw(frames ? 1 / 60 : 0);
    return drawer.canvas.toDataURL('image/png');
  },
  resize(width: number, height: number) { drawer.canvas.width = width; drawer.canvas.height = height; },
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
