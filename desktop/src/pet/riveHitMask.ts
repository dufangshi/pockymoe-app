/** Conservative per-clip silhouette unions, baked with a small grab halo. */
export interface RiveHitMaskData {
  width: number;
  height: number;
  /** Row-major, least-significant bit first, with no padding between rows. */
  clips: Record<string, string>;
  /** Extensions used only during reactions and transitions. */
  extra?: string;
}

export class RiveHitMask {
  private readonly clips = new Map<number, Uint8Array>();
  private readonly union: Uint8Array;

  constructor(readonly data: RiveHitMaskData) {
    const { width, height, clips } = data;
    if (![width, height].every((n) => Number.isInteger(n) && n >= 4 && n <= 64))
      throw new Error('Invalid Rive hit-mask dimensions');
    const length = Math.ceil((width * height) / 8);
    const decode = (encoded: string): Uint8Array => {
      if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
        throw new Error('Invalid Rive hit-mask encoding');
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      if (bytes.length !== length) throw new Error('Invalid Rive hit-mask length');
      return bytes;
    };
    this.union = data.extra === undefined ? new Uint8Array(length) : decode(data.extra);
    const entries = Object.entries(clips);
    if (!entries.length || entries.length > 128)
      throw new Error('Invalid Rive hit-mask clip count');
    for (const [key, encoded] of entries) {
      if (!/^(0|[1-9]\d{0,3})$/.test(key) || Number(key) > 1023)
        throw new Error('Invalid Rive hit-mask motion');
      const bytes = decode(encoded);
      if (!bytes.some(Boolean)) throw new Error('Empty Rive hit mask');
      this.clips.set(Number(key), bytes);
      for (let i = 0; i < length; i++) this.union[i] |= bytes[i];
    }
  }

  /** Normalized artboard coordinates. Unknown motions conservatively use the union. */
  contains(x: number, y: number, value?: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= 1 || y >= 1)
      return false;
    const index =
      Math.floor(y * this.data.height) * this.data.width + Math.floor(x * this.data.width);
    const bytes = value === undefined ? this.union : (this.clips.get(value) ?? this.union);
    return !!(bytes[index >> 3] & (1 << (index & 7)));
  }

  /** Native input regions on Windows/Linux, rounded outward without cell gaps. */
  rectangles(bounds: { x: number; y: number; width: number; height: number }, value?: number) {
    const rectangles: { x: number; y: number; width: number; height: number }[] = [];
    for (let row = 0; row < this.data.height; row++) {
      let start = -1;
      for (let col = 0; col <= this.data.width; col++) {
        const solid =
          col < this.data.width &&
          this.contains((col + 0.5) / this.data.width, (row + 0.5) / this.data.height, value);
        if (solid && start < 0) start = col;
        if (!solid && start >= 0) {
          const x = Math.floor(bounds.x + (bounds.width * start) / this.data.width);
          const y = Math.floor(bounds.y + (bounds.height * row) / this.data.height);
          rectangles.push({
            x,
            y,
            width: Math.ceil(bounds.x + (bounds.width * col) / this.data.width) - x,
            height: Math.ceil(bounds.y + (bounds.height * (row + 1)) / this.data.height) - y,
          });
          start = -1;
        }
      }
    }
    return rectangles;
  }
}
