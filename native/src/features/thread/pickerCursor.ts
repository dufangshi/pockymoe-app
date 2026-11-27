// The model picker's keyboard cursor (the Web's useMenuKeyboard over the rows), pure.

export type CursorMove = 'up' | 'down' | 'home' | 'end';

/** The row a key moves to. With no cursor yet the first key lands on `start` (the checked
 *  row) or, failing that, the first row; up and down wrap around as the Web's menus do. */
export function moveCursor(keys: string[], cursor: string | null, move: CursorMove, start?: string | null): string | null {
  if (!keys.length) return null;
  const at = cursor ? keys.indexOf(cursor) : -1;
  if (at < 0) {
    if (move === 'home') return keys[0]!;
    if (move === 'end') return keys[keys.length - 1]!;
    return start && keys.includes(start) ? start : keys[0]!;
  }
  if (move === 'home') return keys[0]!;
  if (move === 'end') return keys[keys.length - 1]!;
  return keys[(at + (move === 'down' ? 1 : -1) + keys.length) % keys.length]!;
}

/** The scroll offset that brings a row into view, or null when it already is. */
export function scrollToShow(row: { y: number; height: number }, scrollY: number, viewHeight: number): number | null {
  if (row.y < scrollY) return Math.max(0, row.y - 4);
  if (row.y + row.height > scrollY + viewHeight) return row.y + row.height - viewHeight + 4;
  return null;
}
