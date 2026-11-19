import { t, type MessageKey } from './i18n';
import type { ActivityItem } from './contract';

// Mirrors upstream StatusMark / docs/ui-principles.md §6 and desktop design v2.
// Approved local-UI exception: docs/ui-principles.md (Electron utility windows).
// Local sandboxed windows cannot import the relay's React component or CSS.
export type StatusMark = 'running' | 'unread' | 'failed' | 'interrupted' | 'waiting' | 'idle' | 'agents-running' | 'unknown';
const labels: Record<StatusMark, MessageKey> = {
  running: '运行中', unread: '已完成，未读', failed: '失败', interrupted: '已中断',
  waiting: '等待你', idle: '已读，空闲', 'agents-running': '智能体线程运行中', unknown: '状态未知'
};
const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function activityStatus(item: Pick<ActivityItem, 'state' | 'unread'>): StatusMark {
  switch (item.state) {
    case 'needsInput': return 'waiting';
    case 'running': case 'failed': case 'interrupted': return item.state;
    case 'completed': return item.unread ? 'unread' : 'idle';
    default: return 'idle';
  }
}
export function statusMarkSvg(status: StatusMark, label?: string): string {
  const kind = Object.hasOwn(labels, status) ? status : 'unknown';
  const ring = '<circle class="status-mark-arc" cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="23 10" transform="rotate(-45 8 8)"/>';
  const shapes: Record<StatusMark, string> = {
    running: ring,
    unread: '<circle cx="8" cy="8" r="3.5" fill="currentColor"/>',
    failed: '<path d="m8 2 6 6-6 6-6-6Z" fill="currentColor"/>',
    interrupted: '<rect x="3.5" y="3.5" width="9" height="9" rx=".6" fill="currentColor"/>',
    waiting: '<path d="M4 2.5h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v3l-3.5-3H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" fill="currentColor"/>',
    idle: '<circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/>',
    'agents-running': '<circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/>',
    unknown: '<circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2"/>'
  };
  return `<svg class="pockymoe-status-mark" data-status="${kind}" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="${escape(label || t(labels[kind]))}">${shapes[kind]}</svg>`;
}
/* Status colors mirror each pack's Web marks (thread-ui matter-workbench.css and
   themes/<pack>/styles): running uses the run color, not the accent, so in a pack whose
   accent is amber (Plum Pocket) running and unread never match "waiting for you". */
export const statusMarkStyles = `
:root{--status-running:oklch(.48 .19 255);--status-waiting:#b77915;--status-agents:#8066cd}
:root[data-theme-effective=dark]{--status-running:oklch(.8 .12 245);--status-waiting:#edb75d;--status-agents:#b39af2}
:root[data-theme-preset=plum-pocket]{--status-running:#2f6fd6;--status-unread:#a87200;--status-agents:#7a52c8;--status-interrupted:#a8701f}
:root[data-theme-preset=plum-pocket][data-theme-effective=dark]{--status-running:#8fc3ff;--status-unread:#f2c15c;--status-agents:#c7a6ff;--status-interrupted:#f0b46a}
:root[data-theme-preset=terminal]{--status-running:var(--theme-accent-solid);--status-waiting:#c08a3e;--status-interrupted:#c08a3e}
:root[data-theme-preset=terminal][data-theme-effective=dark]{--status-waiting:#edb75d}
.pockymoe-status-mark{display:inline-block;flex:0 0 16px;vertical-align:middle;color:var(--theme-fg-muted,#888)}
.pockymoe-status-mark[data-status=running]{color:var(--status-running)}
.pockymoe-status-mark[data-status=unread]{color:var(--status-unread,var(--theme-accent-solid,#008b53))}
.pockymoe-status-mark[data-status=failed]{color:var(--theme-danger,#d8524f)}
.pockymoe-status-mark[data-status=waiting]{color:var(--status-waiting)}
.pockymoe-status-mark[data-status=interrupted]{color:var(--status-interrupted,var(--status-waiting))}
.pockymoe-status-mark[data-status=unknown]{opacity:.55}
.pockymoe-status-mark[data-status=agents-running]{color:var(--theme-agent-running,var(--status-agents))}
`;
