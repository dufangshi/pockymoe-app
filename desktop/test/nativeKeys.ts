import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
const run = promisify(execFile);
/** Native menu accelerators are not Chromium/CDP key events. */
export async function primaryKey(app: ElectronApplication, key: 'k' | '0'): Promise<void> {
  await app.evaluate(({ app }) => { app.focus({ steal: true }); globalThis.__pockymoeDesktopTest.windows.focusMain().webContents.focus(); });
  if (process.platform === 'win32') {
    const handle = await app.evaluate(() => {
      const bytes = globalThis.__pockymoeDesktopTest.windows.main().getNativeWindowHandle();
      return bytes.length === 8 ? bytes.readBigUInt64LE().toString() : String(bytes.readUInt32LE());
    });
    // A process also owns the pet's top-level windows. AppActivate(pid) may
    // select one of those; address and verify the main window's HWND instead.
    const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class PockymoeTestWindow { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'; $target = [IntPtr]::new([Int64]::Parse('${handle}')); if ([PockymoeTestWindow]::GetForegroundWindow() -ne $target) { [PockymoeTestWindow]::SetForegroundWindow($target) | Out-Null }; if ([PockymoeTestWindow]::GetForegroundWindow() -ne $target) { throw 'Test main window is not foreground' }; $keys = New-Object -ComObject WScript.Shell; $keys.SendKeys('^${key}')`;
    await run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  } else if (process.platform === 'darwin') {
    // macOS automation permissions are outside fixture control. Invoke the
    // built native menu command there; Windows exercises actual native keys.
    await app.evaluate(({ Menu }, id) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById(id)!;
      item.click(item, globalThis.__pockymoeDesktopTest.windows.main(), {});
    }, key === 'k' ? 'pockymoe-search' : 'pockymoe-open-map');
  } else throw new Error('Native keyboard driver requires Windows or macOS');
}
