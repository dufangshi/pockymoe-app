import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalState } from '../shared/local';

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
            ...(['moe', 'frost'].includes(id) && directory === this.directories[0] ? { author: 'Pockymoe' } : {}) });
        } catch { /* Incomplete/custom packs must not break Preferences. */ }
      }
    }
  }
  list(): LocalState['petPacks'] { return this.entries.map(entry => ({ ...entry })); }
  asset(url: string): Response {
    const target = new URL(url);
    const asset = target.hostname === 'atlas' && !target.search && !target.hash ? this.assets.get(decodeURIComponent(target.pathname.slice(1))) : null;
    if (!asset) return new Response(null, { status: 404 });
    try {
      const stat = lstatSync(asset.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(readFileSync(asset.path)), { headers: { 'Content-Type': asset.type, 'Cache-Control': 'private, max-age=3600' } });
    } catch { return new Response(null, { status: 404 }); }
  }
}
