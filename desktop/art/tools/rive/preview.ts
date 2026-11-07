import { _electron as electron } from '@playwright/test';
import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import type { preview } from './preview/preview.ts';
declare global { interface Window { preview: typeof preview } }
const [, , file, out, artboard = 'Pet', stateMachine = 'Pet'] = process.argv;
if (!file || !out) throw new Error('Usage: node art/tools/rive/preview.ts pet.riv OUTPUT [artboard] [stateMachine] [--assert-motion]');
const output = resolve(out); await mkdir(output, { recursive: true });
await build({ configFile: false, root: resolve('art/tools/rive/preview'), base: './', build: { outDir: resolve(output, 'app'), emptyOutDir: true, assetsInlineLimit: 0 } });
const main = resolve(output, 'main.cjs');
await writeFile(main, "const { app, BrowserWindow } = require('electron'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); app.whenReady().then(() => { const w = new BrowserWindow({width:384,height:416,transparent:true,frame:false,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}}); w.loadFile(process.argv.at(-1)); });");
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron'), timeout: 30000, args: ['--no-sandbox', '--ozone-platform=x11', main, resolve(output, 'app/index.html')] });
try {
  const page = await app.firstWindow(); page.on('pageerror', e => console.error(e));
  await page.waitForFunction(() => 'preview' in window);
  const bytes = (await readFile(file)).toString('base64');
  // Bound hangs in native import or script initialization as well as malformed files.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Rive load timed out')), 20000); }),
    page.evaluate(async ({ bytes, artboard, stateMachine }) => window.preview.load(bytes, { path: 'pet.riv', artboard, stateMachine }), { bytes, artboard, stateMachine }),
  ]); } finally { clearTimeout(timer); }
  // Image decoding finishes asynchronously after import. Verify visible pixels, not just successful parsing.
  const sizeArg = process.argv.indexOf('--size');
  const size = sizeArg >= 0 ? process.argv[sizeArg + 1].split('x').map(Number) : [384, 416];
  if (size.length !== 2 || size.some(n => !Number.isInteger(n) || n < 64 || n > 2048)) throw new Error('Invalid --size WIDTHxHEIGHT');
  await page.evaluate(([w, h]) => window.preview.resize(w, h), size);
  await page.waitForFunction(async () => {
    const data = window.preview.render(0, 1); const image = new Image(); image.src = data;
    await image.decode(); return true;
  });
  const scenarioArg = process.argv.indexOf('--scenarios');
  if (scenarioArg >= 0) {
    const scenarios = JSON.parse(await readFile(process.argv[scenarioArg + 1], 'utf8')) as { name: string; values: Record<string, number | boolean>; trigger?: string; frames: number[] }[];
    for (const scenario of scenarios) {
      if (!/^[a-zA-Z0-9_-]+$/.test(scenario.name)) throw new Error('Unsafe scenario name');
      await page.evaluate(async ({ bytes, artboard, stateMachine }) => window.preview.load(bytes, { path: 'pet.riv', artboard, stateMachine }), { bytes, artboard, stateMachine });
      await page.evaluate(([w, h]) => window.preview.resize(w, h), size);
      const captures: { label: string; data: string }[] = []; let previous = 0;
      for (const [i, frame] of scenario.frames.entries()) {
        const data = await page.evaluate(({ values, trigger, frames }) => window.preview.render(0, frames, values, trigger), { values: scenario.values, trigger: i ? undefined : scenario.trigger, frames: Math.max(1, frame - previous) }); previous = frame;
        await writeFile(resolve(output, `${scenario.name}-${frame}.png`), Buffer.from(data.split(',')[1], 'base64'));
        captures.push({ label: `frame=${frame} t=${(frame / 60).toFixed(2)}s`, data });
      }
      const sheet = await page.evaluate(({ name, captures }) => window.preview.sheet(name, captures), { name: scenario.name, captures });
      await writeFile(resolve(output, `${scenario.name}.png`), Buffer.from(sheet.split(',')[1], 'base64'));
    }
    console.log(`PASS ${scenarios.length} preview scenarios`);
    await page.evaluate(async ({ bytes, artboard, stateMachine }) => window.preview.load(bytes, { path: 'pet.riv', artboard, stateMachine }), { bytes, artboard, stateMachine });
    await page.evaluate(([w, h]) => window.preview.resize(w, h), size);
  }
  const hashes = new Set<string>();
  for (const [state, name] of ['idle', 'running', 'waiting', 'failed', 'review', 'sleeping', 'resting'].entries()) {
    const frames: { label: string; data: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const values = { mouth: i / 4, lookX: i / 2 - 1, lookY: 1 - i / 2, dock: i, dragging: i === 2 };
      const data = await page.evaluate(({ state, values }) => window.preview.render(state, 30, values), { state, values });
      const png = PNG.sync.read(Buffer.from(data.split(',')[1], 'base64'));
      if (!png.data.some((n, i) => i % 4 === 3 && n > 24)) throw new Error(`Blank rendering: ${name}`);
      hashes.add(createHash('sha256').update(png.data).digest('hex'));
      frames.push({ label: `t=${(i + 1) / 2}s mouth=${values.mouth} look=${values.lookX},${values.lookY} dock=${i} drag=${values.dragging}`, data });
    }
    const sheet = await page.evaluate(({ name, frames }) => window.preview.sheet(name, frames), { name, frames });
    await writeFile(resolve(output, `${scenarioArg >= 0 ? 'state-' : ''}${name}.png`), Buffer.from(sheet.split(',')[1], 'base64'));
  }
  for (const trigger of ['complete', 'fail', 'poke', 'dragStart', 'land', 'wave']) {
    const frames = [];
    await page.evaluate(() => window.preview.render(0, 120, { mouth: 0, dock: 0, dragging: false }));
    for (let i = 0; i < 4; i++) frames.push({ label: `+${i * .2}s`, data: await page.evaluate(({ trigger, i }) => window.preview.render(0, i ? 12 : 0, {}, i ? undefined : trigger), { trigger, i }) });
    const sheet = await page.evaluate(({ trigger, frames }) => window.preview.sheet(trigger, frames), { trigger, frames });
    await writeFile(resolve(output, `${scenarioArg >= 0 ? 'trigger-' : ''}${trigger}.png`), Buffer.from(sheet.split(',')[1], 'base64'));
  }
  if (process.argv.includes('--assert-motion') && hashes.size < 8) throw new Error(`Only ${hashes.size} distinct frames; animation/contract wiring may be broken`);
  await page.evaluate(() => window.preview.render(0, 120, { mouth: 0, lookX: 0, lookY: 0 }));
  await page.screenshot({ path: resolve(output, 'electron-preview.png'), omitBackground: true });
  await page.evaluate(() => window.preview.dispose());
  console.log(`PASS: typed contract, 7 states, 6 triggers, ${hashes.size} distinct frames; ${output}`);
} finally { await app.close(); }
