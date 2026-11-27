import { describe, expect, it } from 'vitest';
import { effortColor, effortIndexAt, effortStopX, orderedEfforts } from '../../src/features/thread/effortModel';
import { formatCompactTokens } from '../../src/features/thread/modelFormat';
import { mixColor, withAlpha } from '../../src/design/contrast';
import { agentMonogram } from '../../src/design/agentMonogram';
import { moveCursor, scrollToShow } from '../../src/features/thread/pickerCursor';
import { modelFactsFromCatalog, readableHandoffText } from '../../vendor/pockymoe/thread-ui/components/composer/modelPicker/modelPickerLogic';

const effort = (reasoningEffort: string) => ({ reasoningEffort, description: '' });

describe('model picker (native)', () => {
  it('orders known effort levels and keeps an opaque catalog order', () => {
    expect(orderedEfforts([effort('high'), effort('low'), effort('medium')]).map(e => e.reasoningEffort)).toEqual(['low', 'medium', 'high']);
    expect(orderedEfforts([effort('turbo'), effort('low')]).map(e => e.reasoningEffort)).toEqual(['turbo', 'low']);
  });
  it('colours levels as the Web does', () => {
    expect(effortColor('medium')).toBe('#16b364');
    expect(effortColor('ultra')).toBe('#9b5cff');
    expect(effortColor('turbo', 0, 3)).toBe('#3d8bff');
    expect(effortColor('turbo', 2, 3)).toBe('#9b5cff');
  });
  it('formats token counts like the shared UI', () => {
    expect(formatCompactTokens(788)).toBe('788');
    expect(formatCompactTokens(1300)).toBe('1.3K');
    expect(formatCompactTokens(12_400)).toBe('12K');
    expect(formatCompactTokens(2_500_000)).toBe('2.5M');
  });
  it('mixes colours for the chosen chip', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(withAlpha('#16b364', 0.18)).toBe('rgba(22, 179, 100, 0.18)');
  });
  it('draws the Web monograms', () => {
    expect(agentMonogram('codex')).toBe('Cx');
    expect(agentMonogram('claude')).toBe('Cl');
    expect(agentMonogram('foo-bar')).toBe('Fo');
  });
  it('matches catalog facts by id, dated snapshot and name', () => {
    const catalog = { models: { 'gpt-5.4': { inputUsdPerMillion: 2.5, outputUsdPerMillion: 15 }, 'claude-opus-5-5': { contextWindowTokens: 1_000_000, inputUsdPerMillion: 4, outputUsdPerMillion: 20 } } };
    expect(modelFactsFromCatalog(catalog, { model: 'gpt-5.4', displayName: 'GPT-5.4' })).toEqual({ contextWindow: undefined, inputUsdPerMillion: 2.5, outputUsdPerMillion: 15 });
    expect(modelFactsFromCatalog(catalog, { model: 'claude-opus-5-5-20261101', displayName: '' })?.contextWindow).toBe(1_000_000);
    expect(modelFactsFromCatalog(catalog, { model: 'unknown', displayName: 'Nope' })).toBeNull();
  });
  it('summarises the handoff Git state for reading', () => {
    const text = 'Current Git state:\n{"branch":"main","upstream":"origin/main","ahead":1,"behind":0,"files":[{"path":"a.ts"}]}';
    expect(readableHandoffText(text)).toBe('Current Git state:\nBranch main → origin/main · ahead 1 · behind 0\n1 changed file: a.ts');
  });
});

describe('model picker keyboard cursor', () => {
  const keys = ['a', 'b', 'c'];
  it('starts on the checked row, then moves and wraps', () => {
    expect(moveCursor(keys, null, 'down', 'b')).toBe('b');
    expect(moveCursor(keys, null, 'down')).toBe('a');
    expect(moveCursor(keys, 'b', 'down')).toBe('c');
    expect(moveCursor(keys, 'c', 'down')).toBe('a');
    expect(moveCursor(keys, 'a', 'up')).toBe('c');
    expect(moveCursor(keys, 'b', 'home')).toBe('a');
    expect(moveCursor(keys, null, 'end')).toBe('c');
    // A cursor on a row that left the list (search narrowed it) starts over.
    expect(moveCursor(keys, 'gone', 'up', 'c')).toBe('c');
    expect(moveCursor([], 'a', 'down')).toBeNull();
  });
  it('scrolls only when the row is out of view', () => {
    expect(scrollToShow({ y: 100, height: 44 }, 0, 300)).toBeNull();
    expect(scrollToShow({ y: 400, height: 44 }, 0, 300)).toBe(148);
    expect(scrollToShow({ y: 20, height: 44 }, 50, 300)).toBe(16);
  });
});

describe('effort slider geometry', () => {
  it('puts each level on its tick and snaps a touch to the nearest', () => {
    expect(effortStopX(0, 3, 214, 14)).toBe(7);
    expect(effortStopX(2, 3, 214, 14)).toBe(207);
    expect(effortStopX(1, 3, 214, 14)).toBe(107);
    expect(effortIndexAt(0, 3, 214, 14)).toBe(0);
    expect(effortIndexAt(150, 3, 214, 14)).toBe(1);
    expect(effortIndexAt(170, 3, 214, 14)).toBe(2);
    expect(effortIndexAt(999, 3, 214, 14)).toBe(2);
    expect(effortIndexAt(50, 1, 214, 14)).toBe(0);
  });
});
