import { expect, type ElectronApplication, type Page } from '@playwright/test';
/** Capture readiness facts only; never dump environment, Web contents or URL queries. */
export async function windowAt(app: ElectronApplication, fragment: string): Promise<Page> {
  let page: Page | undefined;
  try {
    await expect.poll(() => { page = app.windows().find(page => page.url().includes(fragment)); return !!page; }).toBe(true);
  } catch {
    const facts = await app.evaluate(({ app, BrowserWindow }) => ({ ready: app.isReady(), runtime: '__pockymoeDesktopTest' in globalThis,
      windows: BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(), destroyed: window.isDestroyed(), loading: window.webContents.isLoading(), path: new URL(window.webContents.getURL() || 'about:blank').pathname })) }));
    throw new Error(`Electron window did not become ready: ${JSON.stringify(facts)}`);
  }
  await page!.waitForLoadState('domcontentloaded'); return page!;
}
