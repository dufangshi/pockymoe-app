import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';

// Store only the committed sample's generated manifest, atlas and Rive file.
function sampleZip(directory: string): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const path of ['pet.json', 'spritesheet.png', 'pet.riv']) {
    const name = Buffer.from(path), data = readFileSync(join(directory, path));
    const header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt32LE(crc32(data), 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(record, name); offset += header.length + name.length + data.length;
  }
  const directoryBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(3, 8); end.writeUInt16LE(3, 10); end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryBytes, end]);
}

test('the actual Rive benchmark presents at most 30fps independently of display rate', async () => {
  test.setTimeout(60_000);
  const root = mkdtempSync(join(tmpdir(), 'pet-cadence-'));
  try {
    execFileSync(process.execPath, ['art/rive-sample/build.ts', join(root, 'sample')], { timeout: 15_000, stdio: 'pipe' });
    const zip = join(root, 'sample.zip'); writeFileSync(zip, sampleZip(join(root, 'sample')));
    const electron = createRequire(resolve('package.json'))('electron') as string;
    const env: Record<string, string> = {};
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'DISPLAY', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]!;
    await promisify(execFile)(electron, [resolve('.'), '--pet-benchmark-run', 'rive', zip, zip, '--output', join(root, 'run'), '--seconds', '2'], { env, timeout: 40_000, killSignal: 'SIGKILL' });
    const metrics = JSON.parse(readFileSync(join(root, 'run/metrics.json'), 'utf8'));
    expect(metrics.animationSecondsPerSecond).toBeGreaterThan(0.85);
    expect(metrics.animationSecondsPerSecond).toBeLessThan(1.15);
    expect(metrics.drawFrames).toBeGreaterThan(10);
    expect(metrics.drawFrames).toBeLessThanOrEqual(Math.floor(metrics.elapsed * 30) + 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
