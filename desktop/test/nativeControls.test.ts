import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('keeps shell renderer forms free of native selects', () => {
  const offenders: string[] = [];
  const scan = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.(?:tsx?|html)$/.test(entry.name) && /<select\b/i.test(readFileSync(path, 'utf8'))) offenders.push(path);
    }
  };
  scan('src/local'); scan('src/quick');
  expect(offenders).toEqual([]);
});
