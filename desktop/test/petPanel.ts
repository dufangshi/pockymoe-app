import { expect, type ElectronApplication, type Page } from '@playwright/test';
/** From the fixture's known closed state: one native action, then await the glass
 * renderer's acknowledgement. A second toggle based on a stale count closes it. */
export async function openPetPanel(app: ElectronApplication): Promise<{ sprite: Page; glass: Page }> {
  await expect.poll(() => app.windows().filter(p => p.url().includes('/pet/')).length).toBe(2);
  let sprite: Page | undefined, glass: Page | undefined;
  for (const page of app.windows().filter(p => p.url().includes('/pet/'))) {
    await page.waitForFunction(() => !!document.body.dataset.surface);
    if (await page.locator('body').getAttribute('data-surface') === 'sprite') sprite = page;
    else glass = page;
  }
  if (!sprite || !glass) throw new Error('Pet fixture did not create both surfaces');
  await sprite.evaluate(() => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action({ type: 'toggleTray' }));
  await expect(glass.locator('.panel')).toBeVisible();
  return { sprite, glass };
}
