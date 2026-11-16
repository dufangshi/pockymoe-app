import { RiveDrawer } from '../rive';
import { useQuadDrawing } from '../quadControl';

Math.random = () => 0.5;
const stats = { calls: 0, frames: 0, reads: 0, advancedSeconds: 0 };
for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'] as const) {
  const native = WebGL2RenderingContext.prototype[name];
  Object.defineProperty(WebGL2RenderingContext.prototype, name, {
    value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
      stats.calls++;
      return Reflect.apply(native, this, args);
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
// Count actual canvas draws, independently of RAF or timer scheduling.
const load = RiveDrawer.load.bind(RiveDrawer);
RiveDrawer.load = async (...args) => {
  let drawer = await load(...args);
  if (new URLSearchParams(location.search).get('quad') === '1') drawer = useQuadDrawing(drawer);
  const advance = drawer.advance.bind(drawer);
  drawer.advance = seconds => { stats.advancedSeconds += seconds; return advance(seconds); };
  const draw = drawer.draw.bind(drawer);
  drawer.draw = (...args) => { stats.frames++; return draw(...args); };
  return drawer;
};
const drawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]): void {
  if (this.canvas.id === 'clip') stats.frames++;
  Reflect.apply(drawImage, this, args);
};
Object.assign(window, { petBenchmarkStats: stats });
await import('../renderer');
