import { describe, expect, it } from 'vitest';
import { buildRows, findMatches, hunkPatches, inRange, longestLine, numberLines, pairLines, parsePatch, rangeLabel, rangeText } from '../../src/features/diff/model';

const PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,4 +1,5 @@',
  ' import a from "a";',
  '-const x = 1;',
  '-const y = 2;',
  '+const x = 10;',
  '+const y = 20;',
  '+const z = 30;',
  ' export { a };',
  '@@ -10,2 +11,2 @@ function tail() {',
  '-  return 1;',
  '+  return 2;',
  ' }',
  'diff --git a/README.md b/README.md',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/README.md',
  '@@ -0,0 +1,2 @@',
  '+# Title',
  '+Body text',
  'diff --git a/logo.png b/logo.png',
  'index 4444444..5555555 100644',
  'Binary files a/logo.png and b/logo.png differ',
  'diff --git a/old/name.ts b/new/name.ts',
  'similarity index 100%',
  'rename from old/name.ts',
  'rename to new/name.ts',
  '',
].join('\n');

describe('diff model', () => {
  const parsed = parsePatch(PATCH);

  it('parses files with the Web parser', () => {
    expect(parsed.files.map(f => f.path)).toEqual(['src/app.ts', 'README.md', 'logo.png', 'new/name.ts']);
    expect(parsed.files[0]).toMatchObject({ additions: 4, deletions: 3 });
    expect(parsed.files[1]!.created).toBe(true);
    expect(parsed.files[2]!.binary).toBe(true);
    expect(parsed.files[3]!.oldPath).toBe('old/name.ts');
  });

  it('numbers old and new lines per hunk', () => {
    const lines = numberLines(parsed.files[0]!.lines);
    const code = lines.filter(l => l.kind !== 'hunk');
    expect(code.map(l => [l.kind, l.old, l.new])).toEqual([
      ['ctx', 1, 1], ['del', 2, null], ['del', 3, null], ['add', null, 2], ['add', null, 3], ['add', null, 4], ['ctx', 4, 5],
      ['del', 10, null], ['add', null, 11], ['ctx', 11, 12],
    ]);
    expect(lines.filter(l => l.kind === 'hunk').map(l => l.hunk)).toEqual([0, 1]);
  });

  it('pairs removals with the additions after them for split view', () => {
    const pairs = pairLines(numberLines(parsed.files[0]!.lines));
    const sides = pairs.map(p => 'left' in p ? [p.left?.kind ?? null, p.right?.kind ?? null] : p.kind);
    expect(sides).toEqual(['hunk', ['ctx', 'ctx'], ['del', 'add'], ['del', 'add'], [null, 'add'], ['ctx', 'ctx'], 'hunk', ['del', 'add'], ['ctx', 'ctx']]);
  });

  it('keeps one patch per hunk with the exact header, and none for renames', () => {
    const hunks = hunkPatches(PATCH);
    expect(hunks.get('src/app.ts')).toHaveLength(2);
    expect(hunks.get('src/app.ts')![1]).toMatch(/^diff --git a\/src\/app.ts b\/src\/app.ts\nindex .*\n--- a\/src\/app.ts\n\+\+\+ b\/src\/app.ts\n@@ -10,2 \+11,2 @@/);
    expect(hunks.get('src/app.ts')![1]).not.toContain('const x');
    expect(hunks.has('new/name.ts')).toBe(false);
  });

  it('reads the text of a selected range on one side', () => {
    const lines = numberLines(parsed.files[0]!.lines);
    expect(rangeText(lines, { side: 'new', start: 2, end: 4 })).toBe('const x = 10;\nconst y = 20;\nconst z = 30;');
    expect(rangeText(lines, { side: 'old', start: 1, end: 3 })).toBe('import a from "a";\nconst x = 1;\nconst y = 2;');
    expect(rangeLabel({ start: 3, end: 3 })).toBe('L3');
    expect(rangeLabel({ start: 3, end: 5 })).toBe('L3–5');
    const added = lines.find(l => l.kind === 'add')!;
    expect(inRange({ path: 'src/app.ts', side: 'new', start: 2, end: 2 }, 'src/app.ts', added)).toBe(true);
    expect(inRange({ path: 'src/app.ts', side: 'old', start: 2, end: 2 }, 'src/app.ts', added)).toBe(false);
  });

  it('finds matches across files, case-insensitively', () => {
    expect(findMatches(parsed.files, 'CONST Y')).toEqual([{ file: 0, line: 3 }, { file: 0, line: 5 }]);
    expect(findMatches(parsed.files, '  ')).toEqual([]);
  });

  it('builds rows: notes, folded files, limits, annotations', () => {
    const rows = buildRows(parsed, { open: path => path !== 'README.md', split: false, limit: path => path === 'src/app.ts' ? 5 : 100,
      annotated: (path, side, line) => path === 'src/app.ts' && side === 'new' && line === 2, hunks: hunkPatches(PATCH) });
    const kinds = rows.map(r => r.type === 'note' ? `note:${r.note}` : r.type);
    expect(kinds).toEqual(['file', 'hunk', 'line', 'line', 'line', 'line', 'annotation', 'more', 'file', 'file', 'note:binaryChanged', 'file', 'note:renamedOnly']);
    const hunk = rows.find(r => r.type === 'hunk');
    expect(hunk && hunk.type === 'hunk' && hunk.patch?.startsWith('diff --git')).toBe(true);
    const more = rows.find(r => r.type === 'more');
    expect(more && more.type === 'more' && more.remaining).toBe(7);
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length);
  });

  it('builds split rows with unique keys', () => {
    const rows = buildRows(parsed, { open: () => true, split: true, limit: () => 1000 });
    expect(rows.filter(r => r.type === 'pair')).toHaveLength(9);
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length);
    expect(longestLine(parsed)).toBeGreaterThan(30);
  });
});
