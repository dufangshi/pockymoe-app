import { quarantineMode, quarantinePattern } from './test/quarantine';
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts', 'src/pet/**/*.test.ts'], testNamePattern: quarantineMode() === 'only' ? quarantinePattern('vitest') : quarantineMode() === 'exclude' ? new RegExp(`^(?!.*(?:${quarantinePattern('vitest').source})).*$`) : undefined } });
