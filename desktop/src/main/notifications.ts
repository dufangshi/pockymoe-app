import { t, formatList } from '../shared/i18n';
import { Notification, powerMonitor } from 'electron';
import type { ActivityEvent, ActivityItem, PetController } from '../shared/contract';
import { activitySecondary, conversationKey, conversationTitle, groupActivities } from '../shared/activityGroups';
import type { ActivityHub } from './activity';
import { deliveryPolicy, EventCoalescer } from './delivery';
import type { SettingsStore } from './store';
import type { Windows } from './windows';
export const itemPath = (item: Pick<ActivityItem, 'deviceId' | 'threadId'>): string => `/devices/${encodeURIComponent(item.deviceId)}/threads/${encodeURIComponent(item.threadId)}`;
export class Notifications {
  private active = new Map<string, Notification>();
  readonly constructed: { alertId: string; key: string; type: string; at: string; events: { alertId: string; key: string; type: string }[] }[] = [];
  readonly decisions: { alertId: string; type: ActivityEvent['type']; at: string; system: boolean; pet: boolean }[] = [];
  private batch: EventCoalescer;
  private delivered = new Map<Notification, ActivityEvent[]>();
  refreshLocale(): void {
    const groups = [...this.delivered.entries()];
    for (const [notification, events] of groups) { notification.close(); this.show(events); }
  }
  constructor(private hub: ActivityHub, private settings: SettingsStore, private windows: Windows, private pet: () => PetController | undefined, private focusedKey: () => string | null) {
    this.batch = new EventCoalescer(events => this.show(events));
    hub.onEvent(event => {
      if (event.type === 'resolved') { this.close(event.alertId); return; }
      const decision = this.policy(event);
      this.decisions.push({ alertId: event.alertId, type: event.type, at: event.at, ...decision });
      if (this.decisions.length > 100) this.decisions.shift();
      if (decision.system) this.batch.add(event);
    });
    hub.onAcknowledge(id => this.close(id));
    settings.onChange(() => { if (Date.parse(settings.get().snoozeUntil || '') > Date.now()) this.batch.dispose(); });
  }
  private policy(event: ActivityEvent): { pet: boolean; system: boolean } {
    const focused = [...this.windows.relay].find(w => w.isFocused());
    return deliveryPolicy(event, { settings: this.settings.get(), focused: !!focused,
      focusedThreadKey: this.focusedKey(), petVisible: this.pet()?.isVisible() ?? false,
      idleSeconds: powerMonitor.getSystemIdleTime() });
  }
  shouldSpeak(event: ActivityEvent): boolean { return this.policy(event).pet; }
  private close(id: string): void {
    this.batch.remove(id);
    const notification = this.active.get(id);
    notification?.close();
    if (process.platform === 'darwin') Notification.remove(notification?.id || id);
    this.active.delete(id);
  }
  private show(all: ActivityEvent[]): void {
    const events = all.filter(e => this.policy(e).system);
    if (!events.length || !Notification.isSupported()) return;
    const first = events[0]; const item = first.item;
    const multiple = events.length > 2;
    const conversations = groupActivities(events.map(e => e.item), this.hub.snapshot()?.items);
    const allComplete = events.every(e => e.type === 'completed');
    const notification = new Notification({
      id: first.alertId,
      groupId: `pockymoe:${conversationKey(item)}`,
      title: multiple && conversations.length > 1 ? t(allComplete ? '{count} 个对话完成' : '{count} 个对话有新进展', { count: conversations.length }) : conversationTitle(item, this.hub.snapshot()?.items),
      subtitle: multiple && conversations.length > 1 ? 'Pockymoe' : activitySecondary(item),
      body: multiple ? formatList(conversations.map(group => `${group.title} · ${formatList(group.items.map(activitySecondary))}`).slice(0, 3)) : item.state === 'interrupted' ? `${t('已中断')}${item.resultSummary ? ` · ${item.resultSummary}` : ''}` : item.request?.summary || item.resultSummary || (first.type === 'failed' ? t('任务遇到了问题') : t('已完成')),
      silent: !this.settings.get().petSound,
      ...(['darwin', 'win32'].includes(process.platform) && !multiple ? { actions: [
        ...(item.request?.kind === 'approval' ? [{ type: 'button' as const, text: t('批准') }, { type: 'button' as const, text: t('拒绝') }] : []),
        { type: 'button' as const, text: t('在地图中显示') }
      ] } : {}),
      // Map every underlying alert id so acknowledgement closes the batch.
      ...(process.platform === 'win32' ? { timeoutType: 'default' as const } : {})
    });
    if (process.env.POCKYMOE_DESKTOP_E2E === '1') {
      this.constructed.push({ alertId: first.alertId, key: item.key, type: first.type, at: new Date().toISOString(), events: events.map(event => ({ alertId: event.alertId, key: event.item.key, type: event.type })) });
      if (this.constructed.length > 100) this.constructed.shift();
    }
    for (const event of events) { this.close(event.alertId); this.active.set(event.alertId, notification); }
    const acknowledge = (): void => { for (const event of events) this.hub.acknowledge(event.alertId, 'notification'); };
    notification.on('click', () => {
      acknowledge();
      void this.windows.dispatch({ type: 'navigate', path: itemPath(item) }).then(() => this.windows.dispatch({ type: 'markRead', key: item.key }, false));
    });
    notification.on('action', (_e, index) => {
      if (item.request?.kind !== 'approval' || index >= 2) {
        acknowledge(); void this.windows.dispatch({ type: 'revealInMap', key: item.key }); return;
      }
      void this.windows.dispatch({ type: 'resolveRequest', deviceId: item.deviceId, threadId: item.threadId, requestId: item.request.id, decision: index === 0 ? 'approve' : 'deny' }).then(result => { if (result.ok) acknowledge(); });
    });
    this.delivered.set(notification, events);
    notification.on('close', () => { this.delivered.delete(notification); for (const event of events) if (this.active.get(event.alertId) === notification) this.active.delete(event.alertId); });
    notification.show();
  }
  dispose(): void { this.batch.dispose(); for (const n of new Set(this.active.values())) n.close(); }
}
