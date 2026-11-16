import { PET_FPS } from './frameScheduler';
/** Allow one boundary frame, not a display-rate presentation regression. */
export function assertPresentationRate(frames: number, seconds: number): void {
  if (frames > Math.floor(seconds * PET_FPS) + 1)
    throw new Error(`Pet presented ${frames} frames in ${seconds.toFixed(2)}s; cap is ${PET_FPS}fps`);
}
