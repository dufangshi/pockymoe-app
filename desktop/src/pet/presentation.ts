export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function commandHtml(value: string): string {
  return `<code>${value.split(/(\s+)/).map((part) => /^\s+$/.test(part) ? escapeHtml(part) : `<span class="command-token">${escapeHtml(part)}</span>`).join('')}</code>`;
}

/** Summaries remain plain text; only explicit code and common command cues get a code chip. */
export function requestSummaryHtml(value: string): string {
  const inlineCode = /`([^`\n]+)`/g;
  let result = '', offset = 0;
  for (const match of value.matchAll(inlineCode)) {
    result += escapeHtml(value.slice(offset, match.index)) + commandHtml(match[1]);
    offset = match.index! + match[0].length;
  }
  if (offset) return result + escapeHtml(value.slice(offset));
  const prefixed = /^((?:运行|执行|命令|run|execute|command)\s*[:：]?\s*)([\x20-\x7e]+)$/i.exec(value);
  if (prefixed) return escapeHtml(prefixed[1]) + commandHtml(prefixed[2]);
  if (/^(?:cargo|git|pnpm|npm|npx|yarn|bun|node|python3?|pockymoe|bash|zsh|sh|pwsh|dotnet|go|make|cmake)(?:\s|$)/.test(value)) return commandHtml(value);
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
