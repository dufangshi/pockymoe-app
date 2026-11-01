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
  const ring = '<circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".22"/><circle class="status-mark-orbit" cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="12 21"/>';
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
export const statusMarkStyles = `
.pockymoe-status-mark{display:inline-block;flex:0 0 16px;vertical-align:middle;color:var(--theme-fg-muted,#888)}
.pockymoe-status-mark[data-status=running],.pockymoe-status-mark[data-status=unread]{color:var(--theme-accent-solid,#bd8a3d)}
.pockymoe-status-mark[data-status=failed]{color:var(--theme-danger,#d8524f)}
.pockymoe-status-mark[data-status=interrupted],.pockymoe-status-mark[data-status=waiting]{color:var(--theme-warning,#c58b24)}
.pockymoe-status-mark[data-status=unknown]{opacity:.55}
.pockymoe-status-mark[data-status=agents-running]{color:var(--theme-agent-running,#9870cb);animation:pockymoe-status-breathe 2.4s ease-in-out infinite}
.status-mark-orbit{transform-origin:8px 8px;animation:pockymoe-status-spin 1.1s linear infinite}
@keyframes pockymoe-status-spin{to{transform:rotate(360deg)}}
@keyframes pockymoe-status-breathe{50%{opacity:.5}}
@media(prefers-reduced-motion:reduce){.status-mark-orbit,.pockymoe-status-mark{animation:none!important}}
`;
