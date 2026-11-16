import { expect, it, vi } from 'vitest';
import { PackImages, PetStateDelivery } from './stateDelivery';
import type { PetPack } from './packs';

it('encodes atlas, peek and sleeping images once per loaded pack', () => {
  const image = Buffer.from('fixture'), encode = vi.spyOn(image, 'toString');
  const pack = { image, peekImage: image, sleepingImage: image, manifest: {
    spritesheetPath: 'spritesheet.png', remoteCodex: { peek: { path: 'peek.png' }, sleeping: { path: 'sleeping.png', frames: 1, durationsMs: [1000] } },
  } } as PetPack;
  const cache = new PackImages();
  const assets = cache.get(pack);
  for (let i = 0; i < 100; i++) expect(cache.get(pack)).toBe(assets);
  expect(encode).toHaveBeenCalledTimes(3);
});

it('emits only changes and sends images once per epoch to each renderer, including reload', () => {
  const images = vi.fn(() => ({ imageUrl: 'large image payload' }));
  for (let view = 0; view < 2; view++) {
    const delivery = new PetStateDelivery(), send = vi.fn();
    for (let i = 0; i < 100; i++) delivery.send(1, images, { mood: 'idle', visible: true }, send);
    expect(send.mock.calls.map(call => call[0])).toEqual(['rcDesktop:pet:pack', 'rcDesktop:pet:state']);
    delivery.send(1, images, { mood: 'running', visible: true }, send);
    expect(send.mock.calls.at(-1)).toEqual(['rcDesktop:pet:state', { mood: 'running', visible: true }]);
    delivery.send(2, images, { mood: 'running', visible: true }, send);
    expect(send.mock.calls.filter(call => call[0] === 'rcDesktop:pet:pack')).toHaveLength(2);
    delivery.reset(); delivery.send(2, images, { mood: 'running', visible: true }, send);
    expect(send.mock.calls.filter(call => call[0] === 'rcDesktop:pet:pack')).toHaveLength(3);
  }
  expect(images).toHaveBeenCalledTimes(6);
});
