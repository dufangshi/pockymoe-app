export type RiveBackend = 'webgl2' | 'canvas';

/** Software WebGL still accepts a context, so context creation is not a hardware test. */
export function chooseRiveBackend(features: { webgl?: string; gpu_compositing?: string }): RiveBackend {
  return features.webgl === 'enabled' && features.gpu_compositing === 'enabled' ? 'webgl2' : 'canvas';
}
