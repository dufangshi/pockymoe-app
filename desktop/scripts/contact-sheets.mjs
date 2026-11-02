// Summaries of original Windows captures; originals remain in the artifact.
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
(async () => {
  const root = resolve(process.argv[2]);
  const surfaces = {
    main: (pack, mode) => `real-web/main-${pack}-${mode}-native.png`,
    map: (pack, mode) => `real-web/map-${pack}-${mode}.png`,
    devices: (pack, mode) => `real-web/devices-${pack}-${mode}.png`,
    preferences: (pack, mode) => `preferences-general-${pack}-${mode}-desktop.png`,
    quick: (pack, mode) => `quick-${pack}-${mode}-desktop.png`,
    glass: (pack, mode) => `compat/windows-native-pet-glass-${pack}-${mode}.png`,
  };
  const out = join(root, 'contact-sheets'); mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    for (const [surface, filename] of Object.entries(surfaces)) {
      const tiles = ['classic', 'plum-pocket', 'terminal'].flatMap(pack => ['light', 'dark'].map(mode => {
        const source = filename(pack, mode);
        const image = readFileSync(join(root, source)).toString('base64');
        return `<article><b>${surface} · ${pack} · ${mode}</b><img src="data:image/png;base64,${image}"></article>`;
      }));
      await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;padding:8px;background:#bbb;font:16px Arial;display:grid;grid-template-columns:1fr 1fr;gap:8px}article{background:white;padding:4px;align-self:start}b{display:block;padding:4px}img{display:block;width:100%;height:auto}</style>${tiles.join('')}`);
      await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
      await page.screenshot({ path: join(out, `${surface}.png`), fullPage: true });
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
