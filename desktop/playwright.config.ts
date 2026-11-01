import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'test', testMatch: '*.e2e.ts', workers: 1, timeout: 30_000, projects: [{ name: 'electron' }] });
