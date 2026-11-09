/** Native X11 pointer regression. PACK may be original private art; outputs stay at OUT. */
import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { PNG } from 'pngjs';
import { once } from 'node:events';
const [, , source, output] = process.argv;
if (!source || !output) throw new Error('Usage: node src/pet/tools/grab.mjs PACK_OR_ZIP OUT');
const out = resolve(output);
await mkdir(out, { recursive: true });
let pack = resolve(source);
if (extname(pack).toLowerCase() === '.zip') {
  pack = resolve(out, 'input-pack');
  await mkdir(pack, { recursive: true });
  execFileSync('python3', ['-c', [
    'import zipfile,sys,pathlib',
    'allowed={"pet.json","pet.riv","spritesheet.webp","spritesheet.png","peek.png","peek.webp"}',
    'with zipfile.ZipFile(sys.argv[1]) as z:',
    ' assert len(z.infolist())<=6 and sum(i.file_size for i in z.infolist())<=256*1024*1024',
    ' for i in z.infolist():',
    '  assert i.filename in allowed and not i.is_dir()',
    '  pathlib.Path(sys.argv[2],i.filename).write_bytes(z.read(i))',
  ].join('\n'), resolve(source), pack]);
}
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
    ...(process.env.PET_GRAB_SWIFTSHADER === '1' ? ['--use-angle=swiftshader'] : []),
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
  if (extname(source).toLowerCase() === '.zip') {
    await app.evaluate((_, source) => globalThis.petHarness.importRive(source), resolve(source));
  }
  await sprite.addInitScript(() => {
    window.petGrabProbes = 0;
    const read = WebGL2RenderingContext.prototype.readPixels;
    WebGL2RenderingContext.prototype.readPixels = function (...args) {
      window.petGrabProbes++;
      return read.apply(this, args);
    };
  });
  await sprite.reload();
  await expect(sprite.locator('#character')).toHaveClass(/rive/);
  // A real native window behind the pet proves delivery beyond merely observing
  // setIgnoreMouseEvents. It has no preload or application credentials.
  await app.evaluate(async ({ BrowserWindow }) => {
    const probe = new BrowserWindow({
      x: 0,
      y: 0,
      width: 1280,
      height: 1000,
      frame: false,
      backgroundColor: '#e5e9ed',
      skipTaskbar: true,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    await probe.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="margin:0;background:#e5e9ed"><script>' +
            'window.presses=0;addEventListener("pointerdown",()=>window.presses++);</script>',
        ),
    );
    probe.showInactive();
    globalThis.petDesktopProbe = probe;
  });
  const petWindowIds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((window) => window !== globalThis.petDesktopProbe)
      .sort((a, b) => Number(!!a.getParentWindow()) - Number(!!b.getParentWindow()))
      .map((window) => window.getNativeWindowHandle().readUInt32LE(0)),
  );
  // xvfb-run has no window manager to honor always-on-top hints. Explicitly
  // place only our own desktop fixture behind the two pet windows.
  for (const id of petWindowIds) execFileSync('xdotool', ['windowraise', String(id)]);
  const action = (v) => sprite.evaluate((v) => window.rcDesktop.pet.action(v), v);
  const metrics = () => app.evaluate(() => globalThis.petHarness.metrics());
  const pointer = (x, y) =>
    execFileSync('xdotool', ['mousemove', '--sync', String(Math.round(x)), String(Math.round(y))]);
  let seed = 72451;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const modes = process.env.PET_GRAB_FORWARDED_ONLY === '1'
    ? []
    : process.env.PET_GRAB_MODES?.split(',') ?? [
      'idle',
      'running',
      'waiting',
      'reaction',
      'transition',
      'capsule',
    ];
  for (const mood of modes) {
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
      if (mood !== 'capsule') {
        const outside = manifest.remoteCodex.rive.hitMask ? await sprite.evaluate(() => {
          const bounds = document.querySelector('#character').getBoundingClientRect();
          for (const y of [3, innerHeight - 4])
            for (const x of [3, innerWidth - 4])
              if (
                !window.petRiveHarness.hit(
                  (x - bounds.x) / bounds.width,
                  (y - bounds.y) / bounds.height,
                )
              )
                return { x, y };
          throw new Error('No transparent grab-mask corner');
        }) : { x: 30 - start.sprite.x, y: 930 - start.sprite.y };
        const old = await app.evaluate(() =>
          globalThis.petDesktopProbe.webContents.executeJavaScript('window.presses'),
        );
        pointer(start.sprite.x + outside.x, start.sprite.y + outside.y);
        execFileSync('xdotool', ['mousedown', '1']);
        execFileSync('xdotool', ['mouseup', '1']);
        await expect
          .poll(() =>
            app.evaluate(() =>
              globalThis.petDesktopProbe.webContents.executeJavaScript('window.presses'),
            ),
          )
          .toBe(old + 1);
      }
      const route = await sprite.evaluate(() => window.petRiveHarness.snapshot());
      if (value !== undefined) expect(route.value).toBe(value);
      if (mood === 'transition') expect(route.leaving).toBe(true);
      pointer(native.x + x, native.y + y);
      execFileSync('xdotool', ['mousedown', '1']);
      if (mood !== 'capsule') {
        await sprite.evaluate(() => new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ));
        expect(await sprite.evaluate(() => window.petRiveHarness.inputs().dragging)).toBe(true);
      }
      pointer(native.x + x + 5, native.y + y);
      pointer(native.x + x + 35, native.y + y - 15);
      execFileSync('xdotool', ['mouseup', '1']);
      try {
        await expect
          .poll(async () => (await metrics()).sprite.x)
          .toBeGreaterThan(start.sprite.x + 10);
      } catch (error) {
        rows.push({
          mood,
          trial,
          opaquePoint: { x, y },
          route,
          pass: false,
          nativePointer: execFileSync('xdotool', ['getmouselocation']).toString().trim(),
          ignored: await app.evaluate(() => globalThis.petHarness.ignored()),
        });
        throw error;
      }
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
  await checkForwardedInput({ app, sprite, manifest, pointer, metrics });
} finally {
  const desktopPresses = await app
    .evaluate(() => globalThis.petDesktopProbe?.webContents.executeJavaScript('window.presses'))
    .catch(() => null);
  await writeFile(resolve(out, 'click-through.json'), JSON.stringify({ desktopPresses }, null, 2));
  await writeFile(resolve(out, 'results.json'), JSON.stringify(rows, null, 2));
  await app.close();
  if (video) {
    video.kill('SIGINT');
    await videoExit;
  }
}

async function checkForwardedInput({ app, sprite, manifest, pointer, metrics }) {
  await app.evaluate((_, id) => {
    globalThis.petHarness.inputPlatform('darwin');
    globalThis.petHarness.settings({ petId: id });
    globalThis.petHarness.sync({
      version: 1, accountId: 'grab', generatedAt: new Date().toISOString(),
      focusedThreadKey: null,
      items: [{
        key: 'grab:forwarded', deviceId: 'grab', deviceName: 'Fixture', workspaceId: 'w',
        workspaceLabel: 'Fixture', threadId: 'forwarded', title: 'Forwarded', state: 'running',
        since: new Date().toISOString(), unread: false,
      }],
    });
    globalThis.petHarness.cursor({ x: -10000, y: -10000 });
  }, manifest.id);
  await sprite.reload();
  await expect(sprite.locator('#character')).toHaveClass(/rive/);
  const initial = await metrics();
  await sprite.evaluate(async (position) => {
    await window.rcDesktop.pet.action({ type: 'dragStart', x: 0, y: 0 });
    await window.rcDesktop.pet.action({ type: 'dragEnd', x: 450-position.x, y: 320-position.y });
  }, initial.sprite);
  const clip = manifest.remoteCodex.rive.routing.clips.find((clip) => clip.value === 5);
  const pose = (phase) => sprite.evaluate(({ phase }) => window.petRiveHarness.pose(5, phase), { phase });
  await pose(clip.durationMs * 0.2 / 1000);
  const before = PNG.sync.read(await sprite.screenshot({ omitBackground: true, scale: 'css' }));
  await pose(clip.durationMs * 0.6 / 1000);
  const after = PNG.sync.read(await sprite.screenshot({ omitBackground: true, scale: 'css' }));
  let point;
  for (let y = 4; y < after.height - 4 && !point; y++) {
    for (let x = 4; x < after.width - 4; x++) {
      const index = (y * after.width + x) * 4 + 3;
      if (before.data[index] <= 24 && after.data[index] > 220) {
        point = { x, y };
        break;
      }
    }
  }
  expect(point, 'a body/prop region must move into the stationary cursor').toBeDefined();
  await pose(clip.durationMs * 0.2 / 1000);
  const bounds = await metrics();
  pointer(20, 20);
  await sprite.evaluate(() => {
    window.petForwardedMoves = 0;
    addEventListener('pointermove', () => window.petForwardedMoves++);
  });
  const globalPoint = { x: bounds.sprite.x + point.x, y: bounds.sprite.y + point.y };
  await app.evaluate((_, p) => globalThis.petHarness.cursor(p), globalPoint);
  // Supply one forwarded move and a press through the renderer input queue.
  // Native Linux delivery is tested above; this verifies the macOS policy only.
  await sprite.mouse.move(point.x, point.y);
  expect(await sprite.evaluate(() => window.petForwardedMoves)).toBe(1);
  expect(await app.evaluate(() => globalThis.petHarness.ignored())).toBe(false);
  const firstMoveHit = await app.evaluate(() => globalThis.petHarness.hitMessages().at(-1));
  expect(firstMoveHit.hit).toBe(true);
  await forwardedPressAndDrag(point, bounds, { sprite, metrics });

  // Reposition the cursor once, then let a body animation move under it without
  // another pointer event. A baked clip union already covers the incoming pose.
  await pose(clip.durationMs * 0.2 / 1000);
  const nextBounds = await metrics();
  const stationary = { x: nextBounds.sprite.x + point.x, y: nextBounds.sprite.y + point.y };
  await app.evaluate((_, p) => globalThis.petHarness.cursor(p), stationary);
  await sprite.mouse.move(point.x, point.y);
  await sprite.evaluate(() => { window.petForwardedMoves = 0; });
  const location = execFileSync('xdotool', ['getmouselocation']).toString();
  await pose(clip.durationMs * 0.6 / 1000);
  await sprite.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  expect(execFileSync('xdotool', ['getmouselocation']).toString()).toBe(location);
  expect(await sprite.evaluate(() => window.petForwardedMoves)).toBe(0);
  expect(await app.evaluate(() => globalThis.petHarness.ignored())).toBe(false);
  await forwardedPressAndDrag(point, nextBounds, { sprite, metrics });
  const probes = await sprite.evaluate(() => window.petGrabProbes);
  expect(probes).toBe(0);
  await writeFile(resolve(out, 'forwarded-input.json'), JSON.stringify({
    singleMoveThenPress: 'PASS', stationaryCursorThenPress: 'PASS',
    appGPUReadbacks: probes, macOSTested: false,
    scope: 'darwin policy in Linux Electron; forwarded move and press delivered with CDP',
  }, null, 2));
  await app.evaluate(() => globalThis.petHarness.inputPlatform('native'));
}

async function forwardedPressAndDrag(point, start, { sprite, metrics }) {
  // CDP supplies the press after policy has already accepted the forwarded move.
  // Native Linux grabs are covered above; this is not a macOS delivery test.
  await sprite.mouse.down();
  await sprite.mouse.move(point.x + 5, point.y);
  await sprite.mouse.move(point.x + 35, point.y - 15);
  await sprite.mouse.up();
  await expect.poll(async () => (await metrics()).sprite.x).toBeGreaterThan(start.sprite.x + 10);
}
