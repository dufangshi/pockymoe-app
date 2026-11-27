import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.mts';
const merged = mergeConfig(base, defineConfig({ test: { testTimeout: 120000 } }));
merged.test!.include = ['test/lab/**/*.lab.test.ts'];
merged.test!.exclude = ['node_modules/**'];
export default merged;
