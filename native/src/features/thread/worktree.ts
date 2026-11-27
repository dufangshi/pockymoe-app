// A new thread's own worktree (docs/worktrees.md "New thread in its own worktree"). The Web
// names it after the thread's title; the native form has no title field, so the name comes
// from the first line of the prompt instead, with the device's rules for a valid name.

export const WORKTREE_NAME = /^[a-z][a-z0-9_-]{0,31}$/;

/** A worktree name from free text: lowercase words joined by dashes, at most 32 characters,
 *  cut at a word end when one is close. Null when nothing valid is left (the device then
 *  names it after the thread id). */
export function worktreeNameFrom(text: string): string | null {
  const line = text
    .replace(/<pockymoe-quotes>[\s\S]*?<\/pockymoe-quotes>/g, ' ')
    .replace(/\[(?:PHOTO|FILE|QUOTE)[^\]]*\]/g, ' ')
    .split('\n').map(l => l.trim()).find(Boolean) ?? '';
  let slug = '';
  for (const c of line.toLowerCase()) {
    if (/[a-z0-9]/.test(c)) slug += c;
    else if (slug && !slug.endsWith('-')) slug += '-';
  }
  slug = slug.replace(/^[^a-z]+/, '');
  if (slug.length > 32) {
    const cut = slug.slice(0, 33).lastIndexOf('-');
    slug = cut >= 12 ? slug.slice(0, cut) : slug.slice(0, 32);
  }
  slug = slug.replace(/-+$/, '');
  return WORKTREE_NAME.test(slug) ? slug : null;
}

/** `/x/repo` → `/x/repo.worktrees/NAME`, where the device puts it. */
export function worktreePath(workspacePath: string, name: string) {
  return `${workspacePath.replace(/\/+$/, '')}.worktrees/${name}`;
}

/** Branch names the device accepts are checked there; this only catches the obvious. */
export function worktreeFieldError(name: string): 'name' | null {
  return name && !WORKTREE_NAME.test(name) ? 'name' : null;
}
