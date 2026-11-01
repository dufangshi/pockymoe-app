export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function commandHtml(value: string): string {
  return `<code>${value.split(/(\s+)/).map((part) => /^\s+$/.test(part) ? escapeHtml(part) : `<span class="command-token">${escapeHtml(part)}</span>`).join('')}</code>`;
}

/** Unquoted prose stays prose. Unknown commands can opt in with explicit backticks. */
export function isShellCommand(value: string): boolean {
  if (/[?？!！。\n]/.test(value) || /\.\s*$/.test(value)) return false;
  const match = /^(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(value.trim());
  const token = match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
  if (/^[a-z]+:\/\//i.test(token)) return false;
  if (/^(?:cargo|git|pnpm|npm|npx|yarn|bun|node|python3?|pockymoe|bash|zsh|sh|pwsh|powershell|dotnet|go|make|cmake|pytest|uv|ruff|docker|kubectl|curl|wget|ls|cat|rg|find|sed|awk|grep|pip3?)$/.test(token)) return true;
  return /^(?:\.\.?[\\/]|~[\\/]|\/|[A-Za-z]:[\\/])/.test(token) || /^[\w.@+-]+(?:[\\/][\w.@+-]+)+$/.test(token);
}

/** Only explicit code spans or a recognizable command payload get a chip. */
export function requestSummaryHtml(value: string): string {
  const inlineCode = /`([^`\n]+)`/g;
  let result = '', offset = 0;
  for (const match of value.matchAll(inlineCode)) {
    result += escapeHtml(value.slice(offset, match.index)) + commandHtml(match[1]);
    offset = match.index! + match[0].length;
  }
  if (offset) return result + escapeHtml(value.slice(offset));
  const prefixed = /^((?:请?(?:运行|执行)|命令|(?:please\s+)?(?:run|execute)|command)\s*[:：]?\s+)(.+)$/i.exec(value);
  if (prefixed && isShellCommand(prefixed[2])) return escapeHtml(prefixed[1]) + commandHtml(prefixed[2]);
  if (isShellCommand(value)) return commandHtml(value);
  return escapeHtml(value);
}

/** A single continuous outline: the triangle replaces the straight border at its base. */
export function bubbleOutline(width: number, height: number, headX: number, above: boolean) {
  const left = .5, right = width - .5, radius = Math.min(12, width / 4, height / 4), halfTail = 7, tailHeight = 8;
  const tailX = Math.max(radius + halfTail + 1, Math.min(width - radius - halfTail - 1, headX));
  const top = above ? .5 : tailHeight + .5, bottom = top + height - 1;
  const topEdge = above ? `H${right - radius}` : `H${tailX - halfTail} L${tailX} .5 L${tailX + halfTail} ${top} H${right - radius}`;
  const bottomEdge = above ? `H${tailX + halfTail} L${tailX} ${bottom + tailHeight} L${tailX - halfTail} ${bottom} H${left + radius}` : `H${left + radius}`;
  const path = `M${left + radius} ${top} ${topEdge} A${radius} ${radius} 0 0 1 ${right} ${top + radius} V${bottom - radius} A${radius} ${radius} 0 0 1 ${right - radius} ${bottom} ${bottomEdge} A${radius} ${radius} 0 0 1 ${left} ${bottom - radius} V${top + radius} A${radius} ${radius} 0 0 1 ${left + radius} ${top} Z`;
  return { path, tailX, canvasHeight: height + tailHeight, offsetTop: above ? 0 : -tailHeight };
}

export function accentForeground(red: number, green: number, blue: number): '#141414' | '#ffffff' {
  const luminance = [red, green, blue].map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const darkLuminance = ((20 / 255 + .055) / 1.055) ** 2.4;
  return (luminance + .05) / (darkLuminance + .05) >= 1.05 / (luminance + .05) ? '#141414' : '#ffffff';
}
