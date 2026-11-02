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
    const script = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PockymoeTestWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, IntPtr process);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint first, uint second, bool attach);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool PeekMessage(IntPtr message, IntPtr hwnd, uint first, uint last, uint remove);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  public static bool Focus(IntPtr target) {
    if (GetForegroundWindow() == target) return true;
    IntPtr message = Marshal.AllocHGlobal(64);
    try { PeekMessage(message, IntPtr.Zero, 0, 0, 0); } finally { Marshal.FreeHGlobal(message); }
    uint current = GetCurrentThreadId();
    uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    uint owner = GetWindowThreadProcessId(target, IntPtr.Zero);
    bool first = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
    bool second = owner != 0 && owner != current && owner != foreground && AttachThreadInput(current, owner, true);
    try { BringWindowToTop(target); SetForegroundWindow(target); return GetForegroundWindow() == target; }
    finally { if (second) AttachThreadInput(current, owner, false); if (first) AttachThreadInput(current, foreground, false); }
  }
}
'@; $target = [IntPtr]::new([Int64]::Parse('${handle}')); if (-not [PockymoeTestWindow]::Focus($target)) { throw 'Test main window is not foreground' }; $keys = New-Object -ComObject WScript.Shell; $keys.SendKeys('^${key}')`;

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
