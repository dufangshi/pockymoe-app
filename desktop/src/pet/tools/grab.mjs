/** Native X11 pointer regression. PACK may be original private art; outputs stay at OUT. */
import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { once } from 'node:events';
const [, , pack, output] = process.argv;
if (!pack || !output) throw new Error('Usage: node src/pet/tools/grab.mjs PACK OUT');
const out = resolve(output);
await mkdir(out, { recursive: true });
// Optional native desktop capture uses the caller's imageio-ffmpeg binary.
const encoder = process.env.PET_GRAB_VIDEO_ENCODER;
const video = encoder
  ? spawn(
      encoder,
      [
        '-v',
        'error',
        '-y',
        '-f',
        'x11grab',
        '-video_size',
        execFileSync('xdotool', ['getdisplaygeometry']).toString().trim().replace(' ', 'x'),
        '-framerate',
        '30',
        '-i',
        process.env.DISPLAY,
        '-an',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        resolve(out, 'native-grabs.mp4'),
      ],
      { stdio: 'ignore' },
    )
  : null;
const videoExit = video ? once(video, 'exit') : null;
const app = await electron.launch({
  executablePath: electronPath,
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--ozone-platform=x11',
    resolve('.local/desktop-evidence/pet/qa1/harness/main/index.js'),
  ],
  env: {
    ...process.env,
    TMPDIR: out,
    ELECTRON_RENDERER_URL: '',
    POCKYMOE_CLIP_PACK: resolve(pack),
  },
});
const rows = [];
try {
  await app.firstWindow();
  await expect.poll(() => app.evaluate(() => !!globalThis.petHarness)).toBe(true);
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(resolve(pack, 'pet.json'), 'utf8'));
  await app.evaluate(
    (_, id) => globalThis.petHarness.settings({ petId: id, petEdgeHide: false }),
    manifest.id,
  );
  let sprite, glass;
  for (const p of app.windows()) {
    await p.waitForFunction(() => document.body.dataset.surface);
    if ((await p.locator('body').getAttribute('data-surface')) === 'sprite') sprite = p;
    else glass = p;
  }
  await expect(sprite.locator('#character')).toHaveClass(/rive/);
  const action = (v) => sprite.evaluate((v) => window.rcDesktop.pet.action(v), v);
  const metrics = () => app.evaluate(() => globalThis.petHarness.metrics());
  const pointer = (x, y) =>
    execFileSync('xdotool', ['mousemove', '--sync', String(Math.round(x)), String(Math.round(y))]);
  let seed = 72451;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (const mood of process.env.PET_GRAB_MODES?.split(',') ?? [
    'idle',
    'running',
    'waiting',
    'reaction',
    'transition',
    'capsule',
  ]) {
    for (let trial = 0; trial < (mood === 'capsule' ? 20 : 50); trial++) {
      const before = await metrics();
      // Fixture setup only: keep all native drags far from screen snap edges.
      await action({ type: 'dragStart', x: 0, y: 0 });
      await action({
        type: 'dragEnd',
        x: 450 - before.sprite.x,
        y: 320 - before.sprite.y,
      });
      const item = {
        key: 'grab:test',
        deviceId: 'grab',
        deviceName: 'Fixture',
        workspaceId: 'w',
        workspaceLabel: 'Fixture',
        threadId: 'test',
        title: 'Grab',
        state: mood === 'waiting' ? 'needsInput' : 'running',
        since: new Date().toISOString(),
        unread: false,
        ...(mood === 'waiting' ? { request: { id: 'q', kind: 'input', summary: 'Fixture' } } : {}),
      };
      await app.evaluate(
        (_, items) =>
          globalThis.petHarness.sync({
            version: 1,
            accountId: 'grab',
            generatedAt: new Date().toISOString(),
            focusedThreadKey: null,
            items,
          }),
        ['running', 'waiting', 'transition'].includes(mood) ? [item] : [],
      );
      if (mood === 'reaction') await action({ type: 'click' });
      const value = {
        idle: 0,
        running: 5,
        waiting: 9,
        reaction: 13,
        transition: 5,
      }[mood];
      if (value !== undefined) {
        const clip = manifest.remoteCodex.rive.routing.clips.find((clip) => clip.value === value);
        if (!clip) throw new Error(`Missing routed grab fixture motion ${value}`);
        await sprite.evaluate(
          ({ value, phase, transition }) =>
            window.petRiveHarness.pose(value, phase, transition ? 9 : undefined),
          {
            value,
            // Sample the performance, including its large poses, not just the intro.
            phase: (clip.durationMs / 1000) * (0.15 + random() * 0.7),
            transition: mood === 'transition',
          },
        );
      }
      const body = await sprite.locator('#character').boundingBox();
      const bounds = await metrics();
      let x,
        y,
        page = sprite;
      if (mood === 'capsule') {
        await app.evaluate((_, p) => globalThis.petHarness.cursor(p), {
          x: bounds.sprite.x + body.x + body.width / 2,
          y: bounds.sprite.y + body.y + body.height / 2,
        });
        await expect(glass.locator('.controls')).toBeVisible();
        // DOM visibility alone does not mean Electron has shown its native child.
        // Wait for the real 100 ms proximity poll before sending OS events.
        await expect
          .poll(() =>
            app.evaluate(({ BrowserWindow }) => {
              const window = BrowserWindow.getAllWindows().find((w) => !!w.getParentWindow());
              return window.isVisible() && window.getOpacity() > 0.9;
            }),
          )
          .toBe(true);
        const candidates = await glass.evaluate(() => {
          const root = document.querySelector('.controls').getBoundingClientRect(),
            result = [];
          for (let y = root.top + 2; y < root.bottom - 2; y += 2)
            for (let x = root.left + 2; x < root.right - 2; x += 2)
              if (
                document.elementFromPoint(x, y)?.closest('.controls') &&
                !document.elementFromPoint(x, y)?.closest('button')
              )
                result.push({ x, y });
          return result;
        });
        expect(candidates.length).toBeGreaterThan(0);
        ({ x, y } = candidates[Math.floor(random() * candidates.length)]);
        page = glass;
      } else {
        const png = PNG.sync.read(await sprite.screenshot({ omitBackground: true, scale: 'css' }));
        const opaque = [];
        for (let py = 0; py < png.height; py++)
          for (let px = 0; px < png.width; px++)
            if (png.data[(py * png.width + px) * 4 + 3] > 220) opaque.push({ x: px, y: py });
        expect(opaque.length).toBeGreaterThan(0);
        ({ x, y } = opaque[Math.floor(random() * opaque.length)]);
      }
      const start = await metrics(),
        native = mood === 'capsule' ? start.glass : start.sprite;
      const route = await sprite.evaluate(() => window.petRiveHarness.snapshot());
      if (value !== undefined) expect(route.value).toBe(value);
      if (mood === 'transition') expect(route.leaving).toBe(true);
      pointer(native.x + x, native.y + y);
      execFileSync('xdotool', ['mousedown', '1']);
      pointer(native.x + x + 5, native.y + y);
      pointer(native.x + x + 35, native.y + y - 15);
      execFileSync('xdotool', ['mouseup', '1']);
      await expect
        .poll(async () => (await metrics()).sprite.x)
        .toBeGreaterThan(start.sprite.x + 10);
      const after = await metrics();
      if (mood === 'capsule') {
        expect(after.glass.x - start.glass.x).toBe(after.sprite.x - start.sprite.x);
        expect(after.glass.y - start.glass.y).toBe(after.sprite.y - start.sprite.y);
        expect(after.glassVisible).toBe(true);
      }
      rows.push({
        mood,
        trial,
        opaquePoint: { x, y },
        route,
        dx: after.sprite.x - start.sprite.x,
        dy: after.sprite.y - start.sprite.y,
        ...(mood === 'capsule'
          ? {
              capsuleDx: after.glass.x - start.glass.x,
              capsuleDy: after.glass.y - start.glass.y,
            }
          : {}),
        pass: true,
      });
      if (!trial)
        await page.screenshot({
          path: resolve(out, `${mood}.png`),
          omitBackground: true,
        });
      console.log('PASS', mood, trial + 1);
    }
  }
  if (rows.some((row) => row.mood === 'capsule')) {
    for (const theme of ['classic', 'plum-pocket', 'terminal']) {
      for (const effective of ['light', 'dark']) {
        await app.evaluate((_, appearance) => globalThis.petHarness.appearance(appearance), {
          pack: theme,
          effective,
          accent: effective === 'light' ? '#ad782e' : '#e4b86a',
        });
        await glass.screenshot({
          path: resolve(out, `capsule-${theme}-${effective}.png`),
          omitBackground: true,
        });
      }
    }
    const background = await glass.evaluate(() => {
      const r = document.querySelector('.controls').getBoundingClientRect();
      for (let y = r.top + 2; y < r.bottom - 2; y += 2)
        for (let x = r.left + 2; x < r.right - 2; x += 2)
          if (
            document.elementFromPoint(x, y)?.closest('.controls') &&
            !document.elementFromPoint(x, y)?.closest('button')
          )
            return { x, y };
      throw new Error('No capsule background');
    });
    const before = await metrics();
    for (const distance of [0, 3]) {
      pointer(before.glass.x + background.x, before.glass.y + background.y);
      execFileSync('xdotool', ['mousedown', '1']);
      pointer(before.glass.x + background.x + distance, before.glass.y + background.y);
      execFileSync('xdotool', ['mouseup', '1']);
      await glass.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      expect((await metrics()).sprite).toEqual(before.sprite);
    }
    const more = await glass.locator('.controls [data-action="more"]').boundingBox();
    pointer(before.glass.x + more.x + more.width / 2, before.glass.y + more.y + more.height / 2);
    execFileSync('xdotool', ['mousedown', '1']);
    execFileSync('xdotool', ['mouseup', '1']);
    await expect(glass.getByRole('menuitem').first()).toBeVisible();
    expect((await metrics()).sprite).toEqual(before.sprite);
    await action({ type: 'close' });
    pointer(20, 20);
    await app.evaluate(() => globalThis.petHarness.cursor({ x: -10000, y: -10000 }));
    // Wait for the 100 ms cursor poll to reach both renderers before switching.
    await expect(sprite.locator('#app')).toHaveAttribute('data-visible', 'false');
    await expect.poll(() => app.evaluate(() => globalThis.petHarness.ignored())).toBe(false);
    await app.evaluate(() => globalThis.petHarness.settings({ petId: 'moe' }));
    await expect(sprite.locator('#character')).not.toHaveClass(/rive/);
    await expect.poll(() => app.evaluate(() => globalThis.petHarness.ignored())).toBe(true);
    await app.evaluate((_, id) => globalThis.petHarness.settings({ petId: id }), manifest.id);
    await expect(sprite.locator('#character')).toHaveClass(/rive/);
    await expect.poll(() => app.evaluate(() => globalThis.petHarness.ignored())).toBe(false);
    await writeFile(
      resolve(out, 'capsule-regressions.json'),
      JSON.stringify(
        {
          clickWithoutMotion: 'PASS',
          belowThresholdThreePixels: 'PASS',
          buttonStillOpensMenu: 'PASS',
          rasterClickThroughAfterPackSwitch: 'PASS',
          riveGrabAfterPackSwitch: 'PASS',
          themes: 6,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await writeFile(resolve(out, 'results.json'), JSON.stringify(rows, null, 2));
  await app.close();
  if (video) {
    video.kill('SIGINT');
    await videoExit;
  }
}
