import type { PetPack } from './packs';
import type { PetPackImages } from './bridge';

/** Cache by loaded pack identity; switching back to a loaded pack never re-encodes it. */
export class PackImages {
  private cache = new WeakMap<PetPack, PetPackImages>();
  get(pack: PetPack | undefined): PetPackImages {
    if (!pack) return { imageUrl: '' };
    const cached = this.cache.get(pack);
    if (cached) return cached;
    const url = (path: string, bytes: Buffer): string => `data:image/${path.endsWith('png') ? 'png' : 'webp'};base64,${bytes.toString('base64')}`;
    const remote = pack.manifest.remoteCodex;
    const images: PetPackImages = {
      imageUrl: url(pack.manifest.spritesheetPath, pack.image),
      peekArt: pack.peekImage && remote?.peek ? { ...remote.peek, imageUrl: url(remote.peek.path, pack.peekImage) } : undefined,
      sleeping: pack.sleepingImage && remote?.sleeping ? { ...remote.sleeping, imageUrl: url(remote.sleeping.path, pack.sleepingImage) } : undefined,
    };
    this.cache.set(pack, images);
    return images;
  }
}

/** Images have their own epoch message and never enter the frequent state comparison. */
export class PetStateDelivery {
  private epoch = -1;
  private previous = '';
  reset(): void { this.epoch = -1; this.previous = ''; }
  send(epoch: number, images: () => PetPackImages, state: object, send: (channel: string, value: unknown) => void): void {
    if (this.epoch !== epoch) {
      send('rcDesktop:pet:pack', { epoch, ...images() });
      this.epoch = epoch;
      this.previous = '';
    }
    const payload = JSON.stringify(state);
    if (payload === this.previous) return;
    this.previous = payload;
    send('rcDesktop:pet:state', state);
  }
}
