import entries from './quarantine.json';

export function quarantinePattern(kind: 'playwright' | 'vitest'): RegExp {
  const titles = entries.filter(entry => entry.kind === kind).map(entry => entry.test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(titles.join('|') || '(?!)');
}

export function quarantineMode(): 'only' | 'exclude' | undefined {
  if (!process.env.CI) return undefined;
  return process.env.POCKYMOE_QUARANTINE === 'only' ? 'only' : 'exclude';
}
