export interface PageChrome { background: string; foreground: string; toolbar: string }
/** Only resolved colors may cross from the configured page into native chrome. */
export function pageChrome(value: unknown): PageChrome | null {
  if (!value || typeof value !== 'object') return null;
  const colors = value as PageChrome;
  return [colors.background, colors.foreground, colors.toolbar].every(color => typeof color === 'string' && /^#[a-f0-9]{6}$/i.test(color))
    ? { background: colors.background, foreground: colors.foreground, toolbar: colors.toolbar } : null;
}
/** Runs in the trusted page. A flat canvas resolves modern theme colors for Electron. */
export function readPageChrome(): PageChrome | null {
  const style = getComputedStyle(document.documentElement);
  const background = style.getPropertyValue('--theme-bg').trim();
  const foreground = style.getPropertyValue('--theme-fg').trim();
  const toolbar = style.getPropertyValue('--matter-chrome').trim() || background;
  if (![background, foreground, toolbar].every(color => CSS.supports('color', color))) return null;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  const resolve = (color: string, underneath: string): string => {
    context.clearRect(0, 0, 1, 1); context.fillStyle = underneath; context.fillRect(0, 0, 1, 1);
    context.fillStyle = color; context.fillRect(0, 0, 1, 1);
    return '#' + Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('');
  };
  const base = resolve(background, '#ffffff'), bar = resolve(toolbar, base);
  return { background: base, foreground: resolve(foreground, bar), toolbar: bar };
}
