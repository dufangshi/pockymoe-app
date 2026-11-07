import { app, BrowserWindow, screen, session } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { cpus } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetController } from './controller';
import { importPetPack } from './packs';
import { verifyRivePack } from './riveValidation';
import { petMediaResponse } from './media';
import { SettingsStore } from '../main/store';
import { summarizeNativeTrace, type GPUTraceEvent } from './benchmarkTrace';
import type { ActivityHubLike } from '../shared/contract';

type Mode = 'webm' | 'quad' | 'rive';
interface Options {
  rive: string;
  webm: string;
  out: string;
  seconds: number;
  mode?: Mode;
}
interface Sample {
  time: number;
  renderer: number;
  gpu: number;
  rendererPid: number;
  gpuPids: number[];
}
interface Run {
  mode: Mode;
  repeat?: number;
  seconds: number;
  elapsed: number;
  dpr: number;
  rendererCPU: number;
  gpuProcessCPU: number;
  nativeReadsPerSecond: number;
  appReadsPerSecond: number;
  drawFrames: number;
  samples: Sample[];
  display: unknown;
  nativeTrace: ReturnType<typeof summarizeNativeTrace>;
  mediaStart: unknown;
  mediaEnd: unknown;
}

function options(argv: string[]): Options {
  const child = argv.indexOf('--pet-benchmark-run');
  const index = child >= 0 ? child : argv.indexOf('--pet-benchmark');
  const offset = child >= 0 ? 2 : 1;
  const rive = argv[index + offset],
    webm = argv[index + offset + 1];
  const outIndex = argv.indexOf('--output');
  const secondsIndex = argv.indexOf('--seconds');
  const seconds = secondsIndex >= 0 ? Number(argv[secondsIndex + 1]) : 60;
  const mode = child >= 0 ? (argv[index + 1] as Mode) : undefined;
  if (
    !rive ||
    !webm ||
    outIndex < 0 ||
    !argv[outIndex + 1] ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > 120 ||
    (mode && !['webm', 'quad', 'rive'].includes(mode))
  ) {
    throw new Error('Usage: Pockymoe --pet-benchmark Rive.zip WebM.zip --output DIRECTORY [--seconds 60]');
  }
  return { rive: resolve(rive), webm: resolve(webm), out: resolve(argv[outIndex + 1]), seconds, mode };
}

async function waitFor(test: () => Promise<boolean>, description: string): Promise<void> {
  const deadline = performance.now() + 60000;
  while (!(await test())) {
    if (performance.now() >= deadline) throw new Error(`Benchmark timed out: ${description}`);
    await delay(50);
  }
}

async function measure(config: Options): Promise<Run> {
  const mode = config.mode!;
  const store = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  session.defaultSession.protocol.handle(
    'pockymoe-pet',
    async (request) => (await petMediaResponse(request)) ?? new Response(null, { status: 404 }),
  );
  const pack = await importPetPack(
    mode === 'webm' ? config.webm : config.rive,
    join(app.getPath('userData'), 'pets'),
    undefined,
    [],
    verifyRivePack,
  );
  if (Boolean(pack.manifest.remoteCodex?.rive) !== (mode !== 'webm'))
    throw new Error('Wrong benchmark ZIP format');
  store.set({
    petId: pack.manifest.id,
    petSize: 'M',
    petVisible: true,
    petEdgeHide: false,
    petSound: false,
    petVoice: false,
  });
  const hub: ActivityHubLike = {
    snapshot: () => null,
    onSnapshot: () => () => {},
    onEvent: () => () => {},
    acknowledge: () => {},
    onAcknowledge: () => () => {},
  };
  const controller = createPetController(
    {
      hub,
      settings: store,
      petDirectories: [],
      appearance: () => ({ effective: 'light', pack: 'classic', accent: '#ad782e' }),
      onAppearance: () => () => {},
      openPreferences: () => {},
      mainFocused: () => false,
      lowerMain: () => {},
      dispatch: async () => ({ ok: true }),
      speak: async () => null,
      summarize: async () => null,
      shouldSpeak: () => false,
    },
    { quad: mode === 'quad' },
  );
  const window = BrowserWindow.getAllWindows().find((view) => !view.getParentWindow())!;
  const contents = window.webContents;
  contents.on('console-message', (details) => {
    if (details.level === 'error') console.error(`Pet renderer: ${details.message}`);
  });
  try {
    await waitFor(async () => {
      try {
        return await contents.executeJavaScript(
          "!!document.querySelector('#character.rive, #character.clips')",
        );
      } catch {
        return false;
      }
    }, 'pet renderer');
  } catch (error) {
    await writeFile(
      join(config.out, 'failed-renderer.html'),
      await contents.executeJavaScript('document.documentElement.outerHTML'),
    );
    await writeFile(join(config.out, 'failed-pet-window.png'), (await contents.capturePage()).toPNG());
    throw error;
  }
  await delay(3000);
  await writeFile(join(config.out, 'pet-window.png'), (await contents.capturePage()).toPNG());
  const media = () =>
    contents.executeJavaScript(`({
    mood: document.querySelector('#app')?.dataset.mood,
    videos: [...document.querySelectorAll('video')].map(video => ({
      src: video.currentSrc, currentTime: video.currentTime, paused: video.paused,
      ended: video.ended, readyState: video.readyState,
      totalVideoFrames: video.getVideoPlaybackQuality().totalVideoFrames,
      droppedVideoFrames: video.getVideoPlaybackQuality().droppedVideoFrames
    }))
  })`);
  const mediaStart = await media();
  if (
    mode === 'webm' &&
    !mediaStart.videos.some(
      (video: { paused: boolean; readyState: number }) => !video.paused && video.readyState >= 2,
    )
  )
    throw new Error('WebM control is not playing');
  const debuggerAPI = contents.debugger;
  debuggerAPI.attach('1.3');
  const trace: GPUTraceEvent[] = [];
  let finishTrace!: () => void;
  const traceComplete = new Promise<void>((yes) => {
    finishTrace = yes;
  });
  debuggerAPI.on('message', (_event, name, parameters) => {
    if (name === 'Tracing.dataCollected') trace.push(...parameters.value);
    if (name === 'Tracing.tracingComplete') finishTrace();
  });
  await contents.executeJavaScript('Object.assign(window.petBenchmarkStats, {calls:0,frames:0,reads:0})');
  await debuggerAPI.sendCommand('Tracing.start', {
    categories: 'gpu,disabled-by-default-gpu.service',
    transferMode: 'ReportEvents',
  });
  const sample = (): Sample => {
    const metrics = app.getAppMetrics();
    const rendererPid = contents.getOSProcessId();
    const gpu = metrics.filter((row) => row.type === 'GPU');
    return {
      time: performance.now(),
      rendererPid,
      gpuPids: gpu.map((row) => row.pid),
      renderer: metrics.find((row) => row.pid === rendererPid)?.cpu.cumulativeCPUUsage ?? 0,
      gpu: gpu.reduce((sum, row) => sum + (row.cpu.cumulativeCPUUsage ?? 0), 0),
    };
  };
  const samples = [sample()];
  for (let i = 0; i < config.seconds; i++) {
    await delay(1000);
    samples.push(sample());
  }
  await debuggerAPI.sendCommand('Tracing.end');
  await Promise.race([
    traceComplete,
    delay(15000).then(() => {
      throw new Error('Native trace stop timed out');
    }),
  ]);
  debuggerAPI.detach();
  const first = samples[0],
    last = samples.at(-1)!;
  if (
    samples.some(
      (row) =>
        row.rendererPid !== first.rendererPid ||
        JSON.stringify(row.gpuPids) !== JSON.stringify(first.gpuPids),
    )
  ) {
    throw new Error('Renderer or GPU process restarted during benchmark');
  }
  const elapsed = (last.time - first.time) / 1000;
  const stats = (await contents.executeJavaScript('window.petBenchmarkStats')) as {
    frames: number;
    reads: number;
  };
  if (mode !== 'webm' && !stats.frames) throw new Error('WebGL control did not draw');
  const mediaEnd = await media();
  const display = await contents.executeJavaScript(`({
    dpr: devicePixelRatio, width: innerWidth, height: innerHeight,
    backend: document.querySelector('#rive')?.dataset.backend,
    canvases: [...document.querySelectorAll('canvas')].map(c => ({width:c.width,height:c.height}))
  })`);
  const nativeTrace = summarizeNativeTrace(trace);
  const result: Run = {
    mode,
    seconds: config.seconds,
    elapsed,
    dpr: screen.getPrimaryDisplay().scaleFactor,
    rendererCPU: ((last.renderer - first.renderer) / elapsed) * 100,
    gpuProcessCPU: ((last.gpu - first.gpu) / elapsed) * 100,
    nativeReadsPerSecond: nativeTrace.readPixels / elapsed,
    appReadsPerSecond: stats.reads / elapsed,
    drawFrames: stats.frames,
    samples,
    display,
    nativeTrace,
    mediaStart,
    mediaEnd,
  };
  await writeFile(join(config.out, 'native-trace.json'), JSON.stringify({ traceEvents: trace }));
  await writeFile(join(config.out, 'metrics.json'), JSON.stringify(result, null, 2));
  controller.dispose();
  return result;
}

async function childRun(config: Options, mode: Mode, repeat: number): Promise<Run> {
  const out = join(config.out, `${mode}-run${repeat}`);
  // Electron retains leading Chromium switches in argv. argv[1] can be a
  // switch, so relaunch the application directory instead of guessing an index.
  const prefix = app.isPackaged ? [] : [app.getAppPath()];
  const switches =
    process.platform === 'linux'
      ? ['--no-sandbox', '--enable-unsafe-swiftshader', '--ozone-platform=x11']
      : [];
  const factor = app.commandLine.getSwitchValue('force-device-scale-factor');
  if (factor) switches.push(`--force-device-scale-factor=${factor}`);
  console.log(
    `START ${mode}, run ${repeat}/3, ${config.seconds} s, DPR ${screen.getPrimaryDisplay().scaleFactor}`,
  );
  const args = [
    ...switches,
    ...prefix,
    '--pet-benchmark-run',
    mode,
    config.rive,
    config.webm,
    '--output',
    out,
    '--seconds',
    String(config.seconds),
  ];
  const output = await new Promise<string>((yes, no) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (bytes) => {
      log += bytes;
    });
    child.stderr.on('data', (bytes) => {
      log += bytes;
    });
    child.on('error', no);
    child.on('exit', (code) =>
      code === 0 ? yes(log) : no(new Error(`Benchmark child failed (${code}): ${log.slice(-2000)}`)),
    );
  });
  await writeFile(join(config.out, `${mode}-run${repeat}.log`), output);
  return { ...JSON.parse(await readFile(join(out, 'metrics.json'), 'utf8')), repeat };
}

/** Runs before normal startup: no account, normal profile, relay or Supervisor. */
export async function runPetBenchmark(argv: string[]): Promise<void> {
  const config = options(argv);
  await mkdir(config.out, { recursive: true });
  const profile = join(config.out, config.mode ? 'profile' : 'coordinator-profile');
  await mkdir(profile, { recursive: true });
  app.setPath('userData', profile);
  app.on('window-all-closed', () => {});
  await app.whenReady();
  try {
    if (config.mode) {
      await measure(config);
      return;
    }
    const runs: Run[] = [];
    for (let repeat = 1; repeat <= 3; repeat++) {
      const modes: Mode[] = repeat % 2 ? ['webm', 'quad', 'rive'] : ['rive', 'quad', 'webm'];
      for (const mode of modes) runs.push(await childRun(config, mode, repeat));
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[1];
    const total = (mode: Mode) =>
      median(runs.filter((row) => row.mode === mode).map((row) => row.rendererCPU + row.gpuProcessCPU));
    const reference = total('webm'),
      quad = total('quad');
    const table = (['webm', 'quad', 'rive'] as const).map((mode) => {
      const rows = runs.filter((row) => row.mode === mode);
      return {
        mode,
        renderer: median(rows.map((row) => row.rendererCPU)),
        gpu: median(rows.map((row) => row.gpuProcessCPU)),
        rendererPlusGPU: total(mode),
        ratioToWebM: total(mode) / reference,
        nativeReadsPerSecond: median(rows.map((row) => row.nativeReadsPerSecond)),
        appReadsPerSecond: median(rows.map((row) => row.appReadsPerSecond)),
        webglDrawFramesPerSecond: median(rows.map((row) => row.drawFrames / row.elapsed)),
      };
    });
    const packs = {} as Record<string, string>;
    for (const [name, path] of [
      ['rive', config.rive],
      ['webm', config.webm],
    ]) {
      packs[name] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
    }
    const result = {
      unit: 'CPU seconds / wall seconds × 100; one logical core = 100%',
      logicalCPUs: cpus().length,
      dpr: screen.getPrimaryDisplay().scaleFactor,
      seconds: config.seconds,
      repeats: 3,
      packs,
      table,
      runs,
      riveMinusQuad: total('rive') - quad,
      overheadRatioToWebM: (total('rive') - quad) / reference,
      softwareHostGatePass: config.seconds === 60 && total('rive') - quad <= reference,
      features: app.getGPUFeatureStatus(),
      appVersion: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      architecture: process.arch,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
    };
    await writeFile(join(config.out, 'backend-medians.json'), JSON.stringify(result, null, 2));
    console.log(result.unit, `(${result.logicalCPUs} logical cores, DPR ${result.dpr})`);
    console.table(table);
    console.log(
      `Rive minus quad / WebM: ${result.overheadRatioToWebM.toFixed(3)}; 60-second software-host gate: ${result.softwareHostGatePass}`,
    );
  } finally {
    app.quit();
  }
}
