import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
const run = promisify(execFile);
/** Native menu accelerators are not Chromium/CDP key events. */
export async function primaryKey(app: ElectronApplication, key: 'k' | '0'): Promise<void> {
  await app.evaluate(({ app }) => { app.focus({ steal: true }); globalThis.__pockymoeDesktopTest.windows.focusMain(); });
  if (process.platform === 'win32') {
    await run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', `$keys = New-Object -ComObject WScript.Shell; $keys.SendKeys('^${key}')`]);
  } else if (process.platform === 'darwin') {
    // macOS automation permissions are outside fixture control. Invoke the
    // built native menu command there; Windows exercises actual native keys.
    await app.evaluate(({ Menu }, id) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById(id)!;
      item.click(item, globalThis.__pockymoeDesktopTest.windows.main(), {});
    }, key === 'k' ? 'pockymoe-search' : 'pockymoe-open-map');
  } else throw new Error('Native keyboard driver requires Windows or macOS');
}
