/** Exercise the real controller pack action against the bundled MOE assets. */
import { _electron as electron, expect } from '@playwright/test';
import executablePath from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [pack, output] = process.argv.slice(2);
if (!pack || !output) throw new Error('Usage: node src/pet/tools/pack-switch.mjs PACK_FOLDER OUT');
const out = resolve(output);
await mkdir(out, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(pack, 'pet.json'), 'utf8'));
const moe = JSON.parse(await readFile(resolve('assets/pets/moe/pet.json'), 'utf8'));
const app = await electron.launch({
  executablePath,
  args: [
    '--no-sandbox',
    ...(process.platform === 'linux' ? ['--ozone-platform=x11', '--enable-unsafe-swiftshader'] : []),
    ...(process.env.PET_GRAB_SWIFTSHADER === '1' ? ['--use-angle=swiftshader'] : []),
    resolve(process.env.PET_SWITCH_HARNESS ?? '.local/desktop-evidence/pet/qa1/harness/main/index.js'),
  ],
  env: { ...process.env, TMPDIR: out, ELECTRON_RENDERER_URL: '', POCKYMOE_CLIP_PACK: resolve(pack) },
});
const rendererErrors = [];
try {
  await app.firstWindow();
  await app.evaluate(async () => {
    while (!globalThis.petHarness) await new Promise((done) => setTimeout(done, 20));
    globalThis.packSwitchErrors = [];
    // Record failures before Electron opens its native error dialog.
    process.on('uncaughtException', (error) => globalThis.packSwitchErrors.push(error.stack));
  });
  let sprite;
  for (const page of app.windows()) {
    await page.waitForFunction(() => document.body.dataset.surface);
    if ((await page.locator('body').getAttribute('data-surface')) === 'sprite') sprite = page;
  }
  if (!sprite) throw new Error('Missing sprite window');
  sprite.on('pageerror', (error) => rendererErrors.push(error.message));
  await sprite.evaluate(() => {
    window.packSwitchStates = [];
    window.rcDesktop.pet.onState((state) => {
      window.packSwitchStates.push({
        name: state.packName,
        imageBytes: state.imageUrl.length,
        rive: !!state.rive,
        clips: !!state.clips,
      });
    });
  });
  const select = async (id) => {
    const result = await sprite.evaluate((id) => window.rcDesktop.pet.action({ type: 'setPack', id }), id);
    expect(result.ok).toBe(true);
    await expect.poll(() => sprite.evaluate(() => window.packSwitchStates.at(-1)?.name))
      .toBe(id === 'moe' ? moe.displayName : manifest.displayName);
    await expect.poll(() => sprite.evaluate(() => window.packSwitchStates.at(-1)?.imageBytes ?? 0))
      .toBeGreaterThan(1000);
  };
  const cycles = [];
  for (let i = 0; i < 10; i++) {
    await select(manifest.id);
    await expect.poll(() => sprite.evaluate(() => window.packSwitchStates.at(-1)?.rive))
      .toBe(!!manifest.remoteCodex?.rive);
    await select('moe');
    await expect(sprite.locator('#character')).not.toHaveClass(/rive/);
    const state = await sprite.evaluate(() => window.packSwitchStates.at(-1));
    expect(state.rive).toBe(false);
    expect(state.clips).toBe(false);
    expect(state.imageBytes).toBeGreaterThan(1000);
    cycles.push({ cycle: i, source: manifest.id, destination: 'moe', pass: true });
  }
  // The catalog deletes an active pack after selecting MOE. Exercise the same
  // sequence against this harness's disposable copy and refresh the controller.
  await select(manifest.id);
  await app.evaluate(() => globalThis.petHarness.removeFixture());
  await expect(sprite.locator('#character')).not.toHaveClass(/rive/);
  const fallback = await sprite.evaluate(() => window.packSwitchStates.at(-1));
  expect(fallback.name).toBe(moe.displayName);
  expect(fallback.imageBytes).toBeGreaterThan(1000);
  const mainErrors = await app.evaluate(() => globalThis.packSwitchErrors);
  expect(mainErrors).toEqual([]);
  expect(rendererErrors).toEqual([]);
  await sprite.screenshot({ path: resolve(out, 'moe.png'), omitBackground: true });
  await writeFile(
    resolve(out, 'result.json'),
    JSON.stringify({ cycles, removedFixture: true, fallback, mainErrors, rendererErrors }, null, 2),
  );
  console.log(`PASS ${cycles.length} ${manifest.id} → MOE controller action cycles`);
} finally {
  await app.close();
}
