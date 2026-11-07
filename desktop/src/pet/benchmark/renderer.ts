import { RiveDrawer } from '../rive';
import { useQuadDrawing } from '../quadControl';

Math.random = () => 0.5;
const stats = { calls: 0, frames: 0, reads: 0 };
let drawn = false;
for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'] as const) {
  const native = WebGL2RenderingContext.prototype[name];
  Object.defineProperty(WebGL2RenderingContext.prototype, name, {
    value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
      const result = Reflect.apply(native, this, args);
      stats.calls++;
      drawn = true;
      return result;
    },
  });
}
const nativeRead = WebGL2RenderingContext.prototype.readPixels;
Object.defineProperty(WebGL2RenderingContext.prototype, 'readPixels', {
  value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
    stats.reads++;
    return Reflect.apply(nativeRead, this, args);
  },
});
const raf = requestAnimationFrame;
window.requestAnimationFrame = (callback) =>
  raf((time) => {
    callback(time);
    if (drawn) {
      stats.frames++;
      drawn = false;
    }
  });
Object.assign(window, { petBenchmarkStats: stats });
if (new URLSearchParams(location.search).get('quad') === '1') {
  const load = RiveDrawer.load.bind(RiveDrawer);
  RiveDrawer.load = async (...args) => useQuadDrawing(await load(...args));
}
await import('../renderer');
