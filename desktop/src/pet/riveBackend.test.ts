import { expect, it } from 'vitest';
import { chooseRiveBackend } from './riveBackend';

it('uses WebGL only with hardware WebGL and GPU compositing', () => {
  expect(chooseRiveBackend({ webgl: 'enabled', gpu_compositing: 'enabled' })).toBe('webgl2');
  for (const features of [{}, { webgl: 'unavailable_software', gpu_compositing: 'disabled_software' }, { webgl: 'enabled', gpu_compositing: 'disabled_software' }, { webgl: 'enabled_readback', gpu_compositing: 'enabled' }]) {
    expect(chooseRiveBackend(features)).toBe('canvas');
  }
});
