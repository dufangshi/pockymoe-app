import { petMediaResponse } from '../pet/media';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalState } from '../shared/local';

/** What a pack says about itself. A license link is required to show a license name. */
function credit(manifest: Record<string, unknown>): Pick<LocalState['petPacks'][number], 'author' | 'source' | 'license' | 'licenseUrl'> {
  const text = (value: unknown): string | undefined => typeof value === 'string' && value.length <= 300 ? value : undefined;
  const link = (value: unknown): string | undefined => text(value)?.startsWith('https://') ? value as string : undefined;
  const author = text(manifest.author), source = link(manifest.sourceUrl), license = text(manifest.license), licenseUrl = link(manifest.licenseUrl);
  return { ...(author ? { author } : {}), ...(source ? { source } : {}), ...(license && licenseUrl ? { license, licenseUrl } : {}) };
}
/** Catalog assets are served only by the local windows' default session. The Web
 * uses a separate partition and never receives a path or an asset handler. */
export class PetCatalog {
  private assets = new Map<string, { path: string; type: string }>();
  private entries: LocalState['petPacks'] = [];
  constructor(private directories: string[]) { this.refresh(); }
  refresh(): void {
    this.assets.clear(); this.entries = [];
    for (const directory of this.directories) {
      let entries; try { entries = readdirSync(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^[\w.-]{1,100}$/.test(entry.name) || entry.name.startsWith('.')) continue;
        try {
          const path = join(directory, entry.name, 'pet.json'), stat = lstatSync(path);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) continue;
          const manifest = JSON.parse(readFileSync(path, 'utf8'));
          const id = entry.name;
          if (this.assets.has(id) || !['spritesheet.webp', 'spritesheet.png'].includes(manifest.spritesheetPath)) continue;
          const image = join(directory, id, manifest.spritesheetPath), imageStat = lstatSync(image);
          if (!imageStat.isFile() || imageStat.isSymbolicLink() || imageStat.size > 8 * 1024 * 1024) continue;
          const name = typeof manifest.displayName === 'string' ? manifest.displayName.slice(0, 100) : id;
          this.assets.set(id, { path: image, type: image.endsWith('.png') ? 'image/png' : 'image/webp' });
          this.entries.push({ id, name, thumbnail: `pockymoe-pet://atlas/${encodeURIComponent(id)}`, rows: manifest.spriteVersionNumber === 2 ? 11 : 9,
            ...(id === 'moe' && directory === this.directories[0] ? { author: 'Pockymoe' } : credit(manifest)) });
        } catch { /* Incomplete/custom packs must not break Preferences. */ }
      }
    }
  }
  list(): LocalState['petPacks'] { return this.entries.map(entry => ({ ...entry })); }
  async asset(request: Request | string): Promise<Response> {
    const req = typeof request === 'string' ? new Request(request) : request;
    const media = await petMediaResponse(req); if (media) return media;
    const target = new URL(req.url);
    const asset = target.hostname === 'atlas' && !target.search && !target.hash ? this.assets.get(decodeURIComponent(target.pathname.slice(1))) : null;
    if (!asset) return new Response(null, { status: 404 });
    try {
      const stat = lstatSync(asset.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(readFileSync(asset.path)), { headers: { 'Content-Type': asset.type, 'Cache-Control': 'private, max-age=3600' } });
    } catch { return new Response(null, { status: 404 }); }
  }
}
