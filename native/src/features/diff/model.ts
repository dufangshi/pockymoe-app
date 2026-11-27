// The diff viewer's model. Parsing is the Web's own (vendored `components/git/patch.ts`),
// so both clients split files, classify lines and count changes the same way. This file
// turns a parsed patch into the rows one list renders: file headings, notes, hunk headers,
// numbered lines (unified) or paired lines (split), "show more" and annotations.
import { parsePatch, type ParsedPatch, type PatchFile, type PatchLine } from '@pockymoe/web-git/patch';

export { parsePatch };
export type { ParsedPatch, PatchFile, PatchLine };

export type Side = 'old' | 'new';
export interface NumberedLine extends PatchLine {
  /** Line number on the old side (context and removed lines). */
  old: number | null;
  /** Line number on the new side (context and added lines). */
  new: number | null;
  /** The hunk this line belongs to, counted from 0 within its file (-1 before the first). */
  hunk: number;
  /** Position within the file's lines, for stable keys and selection. */
  index: number;
}

/** Old and new line numbers for every line, as the Web's `numbered()` counts them. */
export function numberLines(lines: PatchLine[]): NumberedLine[] {
  let old = 0, next = 0, hunk = -1;
  return lines.map((line, index) => {
    if (line.kind === 'hunk') {
      hunk += 1;
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line.text);
      if (match) { old = Number(match[1]); next = Number(match[2]); }
      return { ...line, old: null, new: null, hunk, index };
    }
    if (line.kind === 'del') return { ...line, old: old++, new: null, hunk, index };
    if (line.kind === 'add') return { ...line, old: null, new: next++, hunk, index };
    if (line.kind === 'ctx') return { ...line, old: old++, new: next++, hunk, index };
    return { ...line, old: null, new: null, hunk, index };
  });
}

/** The side a line is read on: removed lines are old, everything else new. */
export const lineSide = (line: Pick<PatchLine, 'kind'>): Side => line.kind === 'del' ? 'old' : 'new';
export const lineNumber = (line: NumberedLine, side: Side = lineSide(line)) => side === 'old' ? line.old : line.new;
export const isCode = (line: Pick<PatchLine, 'kind'>) => line.kind === 'ctx' || line.kind === 'add' || line.kind === 'del';

export interface SplitPair { left: NumberedLine | null; right: NumberedLine | null }
/** Side by side: context on both sides; a run of removals pairs with the additions after it. */
export function pairLines(lines: NumberedLine[]): (SplitPair | NumberedLine)[] {
  const out: (SplitPair | NumberedLine)[] = [];
  let dels: NumberedLine[] = [], adds: NumberedLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = []; adds = [];
  };
  for (const line of lines) {
    if (line.kind === 'del') { if (adds.length) flush(); dels.push(line); continue; }
    if (line.kind === 'add') { adds.push(line); continue; }
    flush();
    if (line.kind === 'ctx') out.push({ left: line, right: line });
    else out.push(line);
  }
  flush();
  return out;
}

/** Git's exact file header and one complete hunk, per file (the Web's `hunkPatches`);
    renames are left out because a hunk patch cannot carry them safely. */
export function hunkPatches(patch: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const file of patch.split(/(?=^diff --git )/m)) {
    const chunks = file.split(/(?=^@@ )/m);
    const header = chunks.shift() ?? '';
    const path = parsePatch(file).files[0]?.path;
    if (path && !header.includes('rename from')) result.set(path, chunks.filter(hunk => hunk.startsWith('@@ ')).map(hunk => header + hunk));
  }
  return result;
}

/** A range of lines on one side of one file, as a review comment refers to it. */
export interface LineRange { path: string; side: Side; start: number; end: number }
export interface Selection extends LineRange { text: string }

/** The text of a range: every line on that side whose number falls inside, without its sign. */
export function rangeText(lines: NumberedLine[], range: Omit<LineRange, 'path'>) {
  return lines.filter(line => isCode(line) && (range.side === 'old' ? line.kind !== 'add' : line.kind !== 'del'))
    .filter(line => { const n = lineNumber(line, range.side); return n !== null && n >= range.start && n <= range.end; })
    .map(line => line.text.slice(1)).join('\n');
}
export const rangeLabel = (range: Pick<LineRange, 'start' | 'end'>) => range.start === range.end ? `L${range.start}` : `L${range.start}–${range.end}`;
export const inRange = (range: LineRange | null, path: string, line: NumberedLine) => {
  if (!range || range.path !== path || !isCode(line)) return false;
  const side = range.side;
  if (side === 'old' ? line.kind === 'add' : line.kind === 'del') return false;
  const n = lineNumber(line, side);
  return n !== null && n >= range.start && n <= range.end;
};

/** Every line containing the query (case-insensitive), in reading order. */
export function findMatches(files: PatchFile[], query: string): { file: number; line: number }[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  const out: { file: number; line: number }[] = [];
  files.forEach((file, fi) => file.lines.forEach((line, li) => {
    if (line.kind !== 'meta' && line.text.toLocaleLowerCase().includes(q)) out.push({ file: fi, line: li });
  }));
  return out;
}

export type DiffRow =
  | { type: 'file'; key: string; fileIndex: number; file: PatchFile; open: boolean }
  | { type: 'note'; key: string; fileIndex: number; note: 'binaryNew' | 'binaryDeleted' | 'binaryChanged' | 'renamedFrom' | 'renamedOnly' | 'emptyFile'; path?: string }
  | { type: 'hunk'; key: string; fileIndex: number; path: string; line: NumberedLine; patch: string | null }
  | { type: 'line'; key: string; fileIndex: number; path: string; line: NumberedLine }
  | { type: 'pair'; key: string; fileIndex: number; path: string; left: NumberedLine | null; right: NumberedLine | null }
  | { type: 'annotation'; key: string; fileIndex: number; path: string; side: Side; line: number }
  | { type: 'more'; key: string; fileIndex: number; path: string; remaining: number }
  | { type: 'preamble'; key: string; text: string };

export interface RowOptions {
  open(path: string): boolean;
  split: boolean;
  /** Lines shown per file before "show more". */
  limit(path: string): number;
  /** Whether something (review threads, drafts, guide notes) hangs under a line. */
  annotated?: (path: string, side: Side, line: number) => boolean;
  hunks?: Map<string, string[]> | null;
  /** A plain file shown as lines: no headings, hunk headers or notes. */
  bare?: boolean;
  /** One file whose name the page already shows: no heading row. */
  noHeading?: boolean;
}

/** One flat list of rows for every file: what the virtualized list renders. */
export function buildRows(parsed: ParsedPatch, options: RowOptions): DiffRow[] {
  const rows: DiffRow[] = [];
  if (parsed.preamble.length) rows.push({ type: 'preamble', key: 'preamble', text: parsed.preamble.map(line => line.text).join('\n') });
  const numbered = parsed.files.map(file => numberLines(file.lines));
  parsed.files.forEach((file, fileIndex) => {
    const open = options.open(file.path);
    const key = `${fileIndex}:${file.path}`;
    if (!options.bare && !options.noHeading) rows.push({ type: 'file', key, fileIndex, file, open });
    const hasHunk = file.lines.some(line => line.kind === 'hunk');
    if (options.bare) {
      for (const line of numbered[fileIndex]!) if (isCode(line)) rows.push({ type: 'line', key: `${key}:l:${line.index}`, fileIndex, path: file.path, line });
      return;
    }
    if (file.binary) rows.push({ type: 'note', key: `${key}:binary`, fileIndex, note: file.created ? 'binaryNew' : file.removed ? 'binaryDeleted' : 'binaryChanged' });
    if (file.oldPath) rows.push({ type: 'note', key: `${key}:rename`, fileIndex, note: hasHunk ? 'renamedFrom' : 'renamedOnly', path: file.oldPath });
    if (!file.binary && file.created && !hasHunk) rows.push({ type: 'note', key: `${key}:empty`, fileIndex, note: 'emptyFile' });
    if (!open) return;
    const lines = numbered[fileIndex]!.filter(line => line.kind !== 'meta');
    const limit = options.limit(file.path);
    const shown = lines.slice(0, limit);
    const hunkList = options.hunks?.get(file.path);
    const annotate = (line: NumberedLine | null) => {
      if (!line || !options.annotated || !isCode(line)) return;
      const side = lineSide(line);
      const n = lineNumber(line, side);
      if (n !== null && options.annotated(file.path, side, n)) rows.push({ type: 'annotation', key: `${key}:a:${line.index}`, fileIndex, path: file.path, side, line: n });
    };
    const units = options.split ? pairLines(shown) : shown;
    for (const unit of units) {
      if ('left' in unit) {
        rows.push({ type: 'pair', key: `${key}:p:${unit.left?.index ?? 'x'}:${unit.right?.index ?? 'x'}`, fileIndex, path: file.path, left: unit.left, right: unit.right });
        annotate(unit.left);
        if (unit.right !== unit.left) annotate(unit.right);
        continue;
      }
      if (unit.kind === 'hunk') { rows.push({ type: 'hunk', key: `${key}:h:${unit.index}`, fileIndex, path: file.path, line: unit, patch: hunkList?.[unit.hunk] ?? null }); continue; }
      rows.push({ type: 'line', key: `${key}:l:${unit.index}`, fileIndex, path: file.path, line: unit });
      annotate(unit);
    }
    if (lines.length > limit) rows.push({ type: 'more', key: `${key}:more`, fileIndex, path: file.path, remaining: lines.length - limit });
  });
  return rows;
}

/** The longest line, for the width of an unwrapped diff. */
export function longestLine(parsed: ParsedPatch) {
  let max = 0;
  for (const file of parsed.files) for (const line of file.lines) if (line.text.length > max) max = line.text.length;
  return max;
}

export const totals = (files: Pick<PatchFile, 'additions' | 'deletions'>[]) =>
  files.reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), { additions: 0, deletions: 0 });

/** A whole file as a patch of context lines, so the viewer can number, find, wrap and
    select its lines exactly as it does a diff's. */
export function fileAsPatch(path: string, content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return `--- a/${path}\n+++ b/${path}\n@@ -1,${lines.length} +1,${lines.length} @@\n${lines.map(line => ` ${line}`).join('\n')}\n`;
}
