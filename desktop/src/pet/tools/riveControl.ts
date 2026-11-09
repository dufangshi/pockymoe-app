/** Alias used only by the isolated development harness. */
import { RiveDrawer as ActualDrawer } from '../rive';
import { useQuadDrawing } from '../quadControl';
export * from '../rive';
export type RiveDrawer = ActualDrawer;
export const RiveDrawer = {
  async load(...args: Parameters<typeof ActualDrawer.load>): Promise<ActualDrawer> {
    const drawer = await ActualDrawer.load(...args);
    // Fixture controls only: native grabs still travel through the OS, preload
    // and real controller. Pin the animation phase before choosing opaque points.
    Object.assign(window, {
      petRiveHarness: {
        pose(value: number, seconds: number, next?: number) {
          drawer.seekMotion(value, seconds);
          drawer.advance(0);
          if (next !== undefined) {
            drawer.set('motion', next);
            drawer.fire('motionStart');
          }
          drawer.draw(0);
        },
        snapshot: () => drawer.route,
        inputs: () => ({
          motion: drawer.inputs.get('motion')?.value,
          dragging: drawer.inputs.get('dragging')?.value,
          response: drawer.inputs.get('response')?.value,
        }),
        hit: (x: number, y: number) => drawer.contains(x, y),
      },
    });
    return new URLSearchParams(location.search).get('riveControl') === 'quad'
      ? useQuadDrawing(drawer)
      : drawer;
  },
};
