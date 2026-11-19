import type { MessageKey } from './i18n';
/** In-app shortcuts. The native menu takes its accelerators from here and Preferences
 * lists the same entries, so the two can never disagree. */
export const appShortcuts = {
  search: { label: '搜索', keys: ['CommandOrControl+K', 'CommandOrControl+F'] },
  openMap: { label: '打开地图', keys: ['CommandOrControl+0'] },
  newThread: { label: '新线程', keys: ['CommandOrControl+N'] },
  preferences: { label: '设置…', keys: ['CommandOrControl+,'] },
  togglePet: { label: '显示 / 隐藏桌宠', keys: ['CommandOrControl+Shift+P'] },
  back: { label: '后退', keys: ['CommandOrControl+['] },
  forward: { label: '前进', keys: ['CommandOrControl+]'] },
  // Ctrl/Cmd+0 opens the map, so actual size moves to Shift+0.
  resetZoom: { label: '实际大小', keys: ['CommandOrControl+Shift+0'] },
  zoomIn: { label: '放大', keys: ['CommandOrControl+='] },
  zoomOut: { label: '缩小', keys: ['CommandOrControl+-'] },
  quit: { label: '退出 Pockymoe', keys: ['CommandOrControl+Q'] },
} as const satisfies Record<string, { label: MessageKey; keys: readonly string[] }>;
export type AppShortcut = keyof typeof appShortcuts;
export const accelerator = (id: AppShortcut): string => appShortcuts[id].keys[0];
