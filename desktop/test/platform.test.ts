import { describe, expect, it, vi } from 'vitest';
import { localFileMatches, modelTar, windowsVoiceAvailable } from '../src/main/platform';
import { windowsPanelPalette, saveName, shortcutLabel, windowPalette, windowsMaterial, windowsGlassMaterial, windowsReservedName } from '../src/shared/platform';
import { toastActivation, toastXml } from '../src/main/windowsToast';
import { dockPosition, petLayout, restorePosition } from '../src/pet/geometry';
import { parseManifest } from '../src/pet/packs';

describe('Windows platform decisions', () => {
  it('uses Mica only on supported Windows builds and a solid fallback otherwise', () => {
    for (const version of ['10.0.19045', '10.0.22000', 'unknown']) expect(windowsMaterial(version)).toBe('none');
    expect(windowsGlassMaterial('10.0.19045')).toBe('solid');
    expect(windowsGlassMaterial('10.0.22621')).toBe('acrylic');
    expect(windowsGlassMaterial('10.0.22621', true)).toBe('solid');
    for (const version of ['10.0.22621', '10.0.26100']) expect(windowsMaterial(version)).toBe('mica');
    for (const pack of ['classic', 'plum-pocket', 'terminal']) for (const effective of ['light', 'dark'] as const) {
      const palette = windowPalette({ pack, effective, accent: '#123' });
      expect(palette.background).toMatch(/^#[a-f0-9]{6}$/); expect(palette.foreground).not.toBe(palette.background);
    }
    expect(windowPalette({ pack: 'custom', effective: 'light', accent: '#123' })).toEqual(windowPalette(null));
    expect(windowPalette({ pack: 'plum-pocket', effective: 'dark', accent: '#123' }).background).toBe('#1b1022');
  });
  it('compares percent-encoded local file URLs using Windows path semantics', () => {
    expect(localFileMatches('file:///C:/Program%20Files/Pockymoe/out/local.html?view=quick', 'C:\\Program Files\\Pockymoe\\out\\local.html', 'win32')).toBe(true);
    expect(localFileMatches('file:///c:/App/local.html', 'C:\\app\\local.html', 'win32')).toBe(true);
    expect(localFileMatches('file:///C:/App/other.html', 'C:\\app\\local.html', 'win32')).toBe(false);
    expect(localFileMatches('https://example.com/local.html', 'C:\\app\\local.html', 'win32')).toBe(false);
    expect(localFileMatches('file:///tmp/local.html', '/tmp/local.html', 'darwin')).toBe(true);
  });
  it('keeps shortcuts and filenames native to their platform', () => {
    expect(shortcutLabel('win32', 'P', true)).toBe('Ctrl+Shift+P');
    expect(shortcutLabel('darwin', 'P', true)).toBe('⌘ / Ctrl ⇧ P');
    expect(saveName('C:\\exports\\report.txt', 'win32')).toBe('report.txt');
    expect(saveName('../../NUL.txt', 'win32')).toBe('_NUL.txt');
    expect(saveName('a:b?.txt. ', 'win32')).toBe('a_b_.txt');
    for (const name of ['con', 'CONIN$', 'CONOUT$', 'COM1', 'lpt9.txt', 'aux', 'name.', 'name ']) expect(windowsReservedName(name)).toBe(true);
    expect(windowsReservedName('console')).toBe(false);
    expect(modelTar('win32')).toBe('C:\\Windows\\System32\\tar.exe');
    expect(modelTar('win32', 'D:\\Windows')).toBe('D:\\Windows\\System32\\tar.exe');
  });
  it('does not offer local speech when an addon or one of its DLLs is missing', () => {
    expect(windowsVoiceAvailable('/addon', () => true)).toBe(true);
    for (const missing of ['sherpa-onnx.node', 'onnxruntime.dll', 'onnxruntime_providers_shared.dll', 'sherpa-onnx-c-api.dll', 'sherpa-onnx-cxx-api.dll']) expect(windowsVoiceAvailable('/addon', path => !path.endsWith(missing))).toBe(false);
  });
  it('rejects Windows device names as pet installation directories', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    try { for (const id of ['con', 'aux', 'com1', 'lpt9']) expect(() => parseManifest(Buffer.from(JSON.stringify({ id, displayName: 'Pet', description: '', spritesheetPath: 'spritesheet.png' })))).toThrow('reserved'); }
    finally { vi.unstubAllGlobals(); }
  });
  it('escapes toast content and restricts action activation URLs', () => {
    const token = '12345678-1234-1234-1234-123456789abc';
    const xml = toastXml(token, '<title>', 'Device & workspace', '"body"', ['Approve', 'Deny', 'Map'], 'file:///C:/icon.png');
    expect(xml).toContain('&lt;title&gt;'); expect(xml).toContain('Device &amp; workspace');
    expect(xml.match(/<action /g)).toHaveLength(3);
    expect(xml).not.toContain('<audio');
    expect(toastXml(token, 'title', '', 'body', [], '', true)).toContain('<audio silent="true"/>');
    expect(toastActivation(`pockymoe://notification/${token}/0`)).toEqual({ token, action: '0' });
    for (const url of [`pockymoe://notification/${token}/9`, `https://notification/${token}/0`, 'pockymoe://notification/../../approve']) expect(toastActivation(url)).toBeNull();
  });
  it('docks in DIP work areas excluding taskbars on every edge, including negative-origin displays', () => {
    for (const scale of [1, 1.25, 1.5, 2]) for (const area of [
      { x: -1920, y: 40, width: 1920, height: 1040 }, { x: 40, y: 0, width: 1880, height: 1080 },
      { x: 0, y: 0, width: 1880, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1040 }
    ]) {
      // Electron supplies DIP coordinates: never multiply by a display's scale factor.
      const display = { id: 2, workArea: area, scaleFactor: scale };
      for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
        const position = restorePosition({ displayId: 2, edge, x: area.x + 100, y: area.y + 100 }, [display], display, 128);
        const docked = dockPosition(position, area, 128), layout = petLayout(docked, area, 128);
        expect(docked.edge).toBe(edge); expect(layout.window.x).toBeGreaterThanOrEqual(area.x); expect(layout.window.y).toBeGreaterThanOrEqual(area.y);
        expect(layout.window.x + layout.window.width).toBeLessThanOrEqual(area.x + area.width);
        expect(layout.window.y + layout.window.height).toBeLessThanOrEqual(area.y + area.height);
        expect(layout.window.height).toBe(128);
      }
    }
  });
});


it('keeps Windows panel text above 4.5:1 over white and black compositor backdrops', () => {
  const rgb = (hex: string): number[] => hex.slice(1).match(/../g)!.map(value => parseInt(value, 16));
  const luminance = (color: number[]): number => color.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  for (const pack of ['classic', 'plum-pocket', 'terminal']) for (const effective of ['light', 'dark'] as const) {
    const palette = windowsPanelPalette({ pack, effective, accent: '#a57224' });
    for (const backdrop of [0, 255]) for (const alpha of [.96, 1]) {
      const background = luminance(rgb(palette.background).map(value => value * alpha + backdrop * (1 - alpha)));
      for (const text of [palette.foreground, palette.muted]) {
        const foreground = luminance(rgb(text));
        expect((Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});
