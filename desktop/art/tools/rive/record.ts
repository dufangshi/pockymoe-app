import { serveRiveBytes } from './binaryServer.ts';
import { _electron as electron } from '@playwright/test';
import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { RivePack } from '../../../src/pet/rive';
import type { preview } from './preview/preview';
declare global {
  interface Window {
    preview: typeof preview;
  }
}
interface Scenario {
  name: string;
  duration: number;
  initial: number;
  /** Seek a routed clip without consuming its intro; useful for fitted key poses. */
  initialTime?: number;
  events?: { at: number; motion: number }[];
  frameValues?: Record<string, number | boolean>[];
}
const [, , pack, out, scenariosFile, fpsString = '24', sizeString = '648x702', dprString = '1'] =
  process.argv;
if (!pack || !out || !scenariosFile)
  throw new Error(
    'Usage: node art/tools/rive/record.ts PACK OUT SCENARIOS [24|30|60|120] [WIDTHxHEIGHT] [DPR]',
  );
const fps = Number(fpsString);
if (![24, 30, 60, 120].includes(fps)) throw new Error('Recording fps must be 24, 30, 60 or 120');
const size = /^(\d+)x(\d+)$/.exec(sizeString);
const width = Number(size?.[1]),
  height = Number(size?.[2]),
  dpr = Number(dprString);
if (!size || width < 32 || height < 32 || width > 2048 || height > 2048 || ![1, 2].includes(dpr))
  throw new Error('Recording size must be 32–2048 CSS pixels per edge; DPR must be 1 or 2');
const backend = 'webgl2';
const output = resolve(out);
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(pack, 'pet.json'), 'utf8')) as {
  remoteCodex: { rive: RivePack };
};
const config = manifest.remoteCodex.rive;
const scenarios = JSON.parse(await readFile(scenariosFile, 'utf8')) as Scenario[];
const rigFile = process.env.RIVE_RECORD_RIG;
const bones = rigFile
  ? (JSON.parse(await readFile(rigFile, 'utf8')) as { bones: { name: string }[] }).bones.map((b) => b.name)
  : [];
await build({
  configFile: false,
  root: resolve('art/tools/rive/preview'),
  base: './',
  build: { outDir: resolve(output, 'app'), emptyOutDir: true, assetsInlineLimit: 0 },
});
const main = resolve(output, 'main.cjs');
await writeFile(
  main,
  `const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
const profile = join(__dirname, 'profile');
require('node:fs').mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('force-device-scale-factor', '${dpr}');
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: ${width}, height: ${height}, transparent: true, frame: false,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  window.loadFile(process.argv.at(-1));
});`,
);
const app = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron'),
  args: [
    '--no-sandbox',
    '--ozone-platform=x11',
    ...(process.env.RIVE_RECORD_SWIFTSHADER === '1' ? ['--use-angle=swiftshader'] : []),
    main,
    resolve(output, 'app/index.html'),
  ],
});
if (process.env.RIVE_RECORD_DEBUG === '1')
  app.process().stderr?.on('data', (data) => process.stderr.write(data));
const bytes = await readFile(resolve(pack, config.path)),
  riveSha256 = createHash('sha256').update(bytes).digest('hex');
const binary = await serveRiveBytes(bytes);
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.error(e));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(m.text());
  });
  await page.waitForFunction(() => 'preview' in window);

  for (const s of scenarios) {
    if (
      !/^[a-zA-Z0-9_-]+$/.test(s.name) ||
      !Number.isFinite(s.duration) ||
      s.duration <= 0 ||
      s.duration > 120
    )
      throw new Error('Invalid recording scenario');
    if (s.initialTime !== undefined && (!Number.isFinite(s.initialTime) || s.initialTime < 0))
      throw new Error('Invalid initial clip time');
    const directory = resolve(output, 'frames', s.name);
    await mkdir(directory, { recursive: true });
    await page.evaluate(
      async ({ url, config, initial, width, height, dpr }) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Cannot read preview binary');
        await window.preview.load(new Uint8Array(await response.arrayBuffer()), config, { motion: initial });
        window.preview.resize(width * dpr, height * dpr);
        const canvas = document.querySelector('canvas')!;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      },
      { url: binary.url, config, initial: s.initial, width, height, dpr },
    );
    await page.waitForFunction(() => window.preview.ready(), {}, { timeout: 15000 });
    if (s.initialTime !== undefined)
      await page.evaluate(
        ({ motion, time }) => window.preview.boundary(motion, time),
        { motion: s.initial, time: s.initialTime },
      );
    const count = Math.round(s.duration * fps),
      samples = [];
    for (let i = 0; i < count; i++) {
      const event = s.events?.find((e) => Math.round(e.at * fps) === i),
        values = { ...s.frameValues?.[i], ...(event ? { motion: event.motion } : {}) };
      const frame = await page.evaluate(
        ({ seconds, values, trigger, bones }) => window.preview.capture(seconds, values, trigger, bones),
        { seconds: i ? 1 / fps : 0, values, trigger: event ? 'motionStart' : undefined, bones },
      );
      await writeFile(
        resolve(directory, `${String(i).padStart(5, '0')}.png`),
        Buffer.from(frame.data.split(',')[1], 'base64'),
      );
      samples.push({
        time: i / fps,
        transforms: frame.transforms,
        route: frame.route,
        inputs: frame.inputs,
        values,
      });
      if (i % 120 === 119) console.log(`${s.name}: ${i + 1}/${count}`);
    }
    await writeFile(
      resolve(output, `${s.name}.json`),
      JSON.stringify({
        name: s.name,
        fps,
        backend,
        viewport: { width, height, dpr },
        riveSha256,
        config,
        scenario: s,
        samples,
      }),
    );
    console.log(`PASS ${s.name}: ${count} frames at ${fps}fps`);
  }
  await page.evaluate(() => window.preview.dispose());
} finally {
  await app.close();
  await binary.close();
}
