import { join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export function localFileMatches(url: string, path: string, platform = process.platform): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    if (platform === 'win32') return win32.normalize(fileURLToPath(parsed, { windows: true })).toLowerCase() === win32.normalize(path).toLowerCase();
    return decodeURIComponent(parsed.pathname) === path;
  } catch { return false; }
}
export function modelTar(platform: string, systemRoot?: string): string {
  return platform === 'win32' ? win32.join(systemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar';
}

export function windowsVoiceAvailable(directory: string, hasFile: (path: string) => boolean): boolean {
  return ['sherpa-onnx.node', 'onnxruntime.dll', 'onnxruntime_providers_shared.dll', 'sherpa-onnx-c-api.dll', 'sherpa-onnx-cxx-api.dll'].every(file => hasFile(join(directory, file)));
}
