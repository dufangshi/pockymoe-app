// Search matches in text: pure, so tests can run them in Node.
export function splitMatches(text: string, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
    if (i > at) parts.push({ text: text.slice(at, i), hit: false });
    parts.push({ text: text.slice(i, i + q.length), hit: true });
    at = i + q.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

/** Trims a snippet to start near the first match ("…words before match …"). */
export function aroundMatch(text: string, query: string, lead = 28) {
  const i = text.toLowerCase().indexOf(query.trim().toLowerCase());
  return i > lead ? `…${text.slice(i - lead).replace(/^\S*\s/, '')}` : text;
}
