import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectWebM } from './webm';
import { parseManifest, importPetPack, type PetPack } from './packs';
import { petMedia, petMediaResponse } from './media';
import { DEFAULT_FACE_BOX, dockedPose, peekPose, surfaceLayout, type PeekArt, type DockEdge } from './geometry';
import { structuralVideo } from './mediaFixture';
const base = { id: 'synthetic', displayName: 'Synthetic', description: '', spritesheetPath: 'spritesheet.png' as const };
const extension = { clipFormat: { mediaType: 'webm-vp9-alpha', fps: 24, columns: 4, width: 648, height: 702 }, clips: { idle: [{ path: 'clips/a.webm', frames: 48 }] } };
describe('new media validation and private range streaming', () => {
  it('checks magic, codec metadata, dimensions and limits independent of extension', () => {
    expect(inspectWebM(structuralVideo())).toMatchObject({ width: 648, height: 702, frames: 48 });
    expect(() => inspectWebM(Buffer.from('not video.webm'))).toThrow();
    expect(() => inspectWebM(structuralVideo(1200))).toThrow();
    expect(() => inspectWebM(structuralVideo(648, 60))).toThrow();
    const wrongCodec = structuralVideo(); wrongCodec.write('V_VP8', wrongCodec.indexOf('V_VP9')); expect(() => inspectWebM(wrongCodec)).toThrow();
    expect(parseManifest(Buffer.from(JSON.stringify({ ...base, remoteCodex: extension }))).remoteCodex?.clipFormat?.mediaType).toBe('webm-vp9-alpha');
    for (const change of [{ fps: 60 }, { width: 1024, height: 1024 }, { mediaType: 'other' }, { mediaType: undefined }]) expect(() => parseManifest(Buffer.from(JSON.stringify({ ...base, remoteCodex: { ...extension, clipFormat: { ...extension.clipFormat, ...change } } })))).toThrow();
  });
  it('serves exact bounded ranges with type, HEAD, suffix, 416 and revocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pet-range-'));
    try {
      await mkdir(join(root, 'clips')); const bytes = structuralVideo(); await writeFile(join(root, 'clips/a.webm'), bytes);
      const pack = { directory: root, image: Buffer.alloc(0), manifest: parseManifest(Buffer.from(JSON.stringify({ ...base, remoteCodex: extension }))) } satisfies PetPack;
      const media = petMedia(pack), url = media.urls['clips/a.webm'];
      const request = (headers?: HeadersInit, method = 'GET') => petMediaResponse(new Request(url, { headers, method }));
      const full = (await request())!; expect(full.headers.get('content-type')).toBe('video/webm'); expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
      const part = (await request({ range: 'bytes=1-6' }))!; expect(part.status).toBe(206); expect(part.headers.get('content-range')).toBe(`bytes 1-6/${bytes.length}`); expect(Buffer.from(await part.arrayBuffer())).toEqual(bytes.subarray(1, 7));
      const suffix = (await request({ range: 'bytes=-4' }))!; expect(Buffer.from(await suffix.arrayBuffer())).toEqual(bytes.subarray(-4));
      expect((await request({ range: 'bytes=99999-' }))!.status).toBe(416);
      expect((await request({ range: 'bytes=0-1,3-4' }))!.status).toBe(416);
      expect((await request(undefined, 'HEAD'))!.headers.get('content-length')).toBe(String(bytes.length));
      media.dispose(); expect((await request())!.status).toBe(404);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('rejects fake WebM bytes at folder import before installing anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pet-invalid-'));
    try {
      await mkdir(join(root, 'clips')); await writeFile(join(root, 'pet.json'), JSON.stringify({ ...base, remoteCodex: extension }));
      await writeFile(join(root, 'clips/a.webm'), 'fake');
      // Atlas header sufficient to reach media validation; decoder validation is a separate gate.
      const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.write('IHDR',12); png.writeUInt32BE(1536,16); png.writeUInt32BE(1872,20); await writeFile(join(root,'spritesheet.png'),png);
      await expect(importPetPack(root, join(root, 'dest'))).rejects.toThrow('WebM');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
const art: PeekArt = { path: 'peek.png', width: 1536, height: 1024, anchor: [.9, .6], headHeight: .6, bounds: [.42, 0, 1, 1] };
describe('visible-head surfaces', () => {
  for (const edge of ['left','right','top','bottom'] as DockEdge[]) for (const amount of [1,.6]) it(`${edge} at ${amount}: edge inset, visible head gap and fixed geometry`, () => {
    const pose = dockedPose(189,205,edge,amount,[.4,.24,.62,.36],art), area = { x: 0,y: 0,width:1000,height:800 };
    const origin = { x: edge === 'right' ? 811 : edge === 'left' ? 0 : 400,y: edge === 'bottom' ? 595 : edge === 'top' ? 0 : 300 };
    const anchor = { ...pose.visible,x: origin.x + pose.visible.x,y: origin.y + pose.visible.y };
    const surface = surfaceLayout(anchor,area,132,36,edge === 'bottom' ? 'above' : 'below',edge);
    expect(surface.x).toBeGreaterThanOrEqual(0); expect(surface.x + surface.width).toBeLessThanOrEqual(1000);
    if (edge === 'left') expect(surface.x).toBe(8); if (edge === 'right') expect(surface.x).toBe(860);
    if (edge === 'bottom') expect(surface.y + 36).toBe(Math.round(anchor.y - 6)); else expect(surface.y).toBe(Math.round(anchor.y + anchor.height + 6));
    if (edge === 'left' || edge === 'right') {
      const r = peekPose(189,205,edge,amount,[.4,.24,.62,.36],art);
      expect(r.y + art.anchor[1]*r.height).toBeCloseTo(.3*205);
      if(edge==='right')expect(r.x+r.width).toBeGreaterThan(189);else expect(r.x).toBeLessThan(0);
    }
  });
  for (const edge of ['left','right','top','bottom'] as DockEdge[]) for (const amount of [1,.6]) it(`MOE ${edge} at ${amount}: surfaces use its existing visible geometry`, () => {
    const pose = dockedPose(118,128,edge,amount,DEFAULT_FACE_BOX), area = { x: 0,y: 0,width:1000,height:800 };
    const anchor = { ...pose.visible,x: (edge === 'right' ? 882 : edge === 'left' ? 0 : 400) + pose.visible.x,y: (edge === 'bottom' ? 672 : edge === 'top' ? 0 : 300) + pose.visible.y };
    const surface = surfaceLayout(anchor,area,132,36,edge==='bottom'?'above':'below',edge);
    expect(surface.x).toBeGreaterThanOrEqual(0); expect(surface.x+surface.width).toBeLessThanOrEqual(1000);
    if(edge==='left')expect(surface.x).toBe(8);if(edge==='right')expect(surface.x).toBe(860);
    if(edge==='bottom')expect(surface.y+36).toBe(Math.round(anchor.y-6));else expect(surface.y).toBe(Math.round(anchor.y+anchor.height+6));
  });
  it('rejects unsafe peek paths and nonfinite anchors', () => {
    for (const peek of [{ ...art,path:'../peek.png' },{ ...art,anchor:[NaN,.5] },{ ...art,headHeight:0 },{ ...art,bounds:[.9,0,.1,1] }]) expect(()=>parseManifest(Buffer.from(JSON.stringify({...base,remoteCodex:{peek}})))).toThrow('peek');
  });
});
