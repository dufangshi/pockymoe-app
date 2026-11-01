import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export default defineConfig({ testDir: 'test', testMatch: '*.e2e.ts', outputDir: join(process.env.POCKYMOE_DESKTOP_EVIDENCE || join(tmpdir(), 'pockymoe-desktop-evidence'), 'playwright'), workers: 1, timeout: 30_000, projects: [{ name: 'electron' }] });
