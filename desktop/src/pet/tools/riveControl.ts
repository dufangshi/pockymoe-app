/** Alias used only by the isolated development harness. */
import { RiveDrawer as ActualDrawer } from '../rive';
import { useQuadDrawing } from '../quadControl';
export * from '../rive';
export type RiveDrawer = ActualDrawer;
export const RiveDrawer = {
  async load(...args: Parameters<typeof ActualDrawer.load>): Promise<ActualDrawer> {
    const drawer = await ActualDrawer.load(...args);
    return new URLSearchParams(location.search).get('riveControl') === 'quad'
      ? useQuadDrawing(drawer)
      : drawer;
  },
};
