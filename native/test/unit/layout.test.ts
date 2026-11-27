import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../src/layout/widthClass';

describe('width classes', () => {
  it('phones stay compact in both orientations', () => {
    expect(computeLayout(412, 915).variant).toBe('compact');
    expect(computeLayout(915, 412).variant).toBe('compact');
  });
  it('foldables and small tablets are medium; big tablets expanded', () => {
    expect(computeLayout(852, 883).variant).toBe('medium');
    expect(computeLayout(1280, 800).variant).toBe('expanded');
    expect(computeLayout(800, 1280).variant).toBe('medium');
  });
  it('puts the column edge on a vertical hinge', () => {
    const open = computeLayout(852, 883, 426);
    expect(open.listWidth).toBe(426);
    expect(open.inspectorWidth).toBe(426);
  });
});
