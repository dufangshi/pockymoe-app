import type { ElectronApplication, Page } from '@playwright/test';
/** Follow renderer/navigation events instead of imposing a separate five-second
 * poll deadline on cold native-window startup. The test's own deadline applies. */
export async function windowAt(app: ElectronApplication, fragment: string): Promise<Page> {
  const page = await new Promise<Page>((resolve, reject) => {
    const observed = new Set<Page>();
    const check = (page: Page): void => { if (page.url().includes(fragment)) { cleanup(); resolve(page); } };
    const navigation = (): void => { for (const page of observed) check(page); };
    const observe = (page: Page): void => { observed.add(page); page.on('framenavigated', navigation); check(page); };
    const closed = (): void => { cleanup(); reject(new Error('Electron closed before the requested window navigated')); };
    const cleanup = (): void => { app.off('window', observe); app.off('close', closed); for (const page of observed) page.off('framenavigated', navigation); };
    app.on('window', observe); app.on('close', closed);
    for (const page of app.windows()) { observe(page); if (page.url().includes(fragment)) break; }
  });
  await page.waitForLoadState('domcontentloaded');
  return page;
}
