import { Notification, powerMonitor } from 'electron';
import type { ActivityEvent, ActivityItem, PetController } from '../shared/contract';
import { activitySecondary, conversationKey, conversationTitle, groupActivities } from '../shared/activityGroups';
import type { ActivityHub } from './activity';
import { deliveryPolicy, EventCoalescer } from './delivery';
import type { SettingsStore } from './store';
import type { Windows } from './windows';
export const itemPath = (item: ActivityItem): string => `/devices/${encodeURIComponent(item.deviceId)}/threads/${encodeURIComponent(item.threadId)}`;
export class Notifications {
  private active = new Map<string, Notification>();
  readonly decisions: { alertId: string; system: boolean; pet: boolean }[] = [];
  private batch: EventCoalescer;
  constructor(private hub: ActivityHub, private settings: SettingsStore, private windows: Windows, private pet: () => PetController | undefined, private focusedKey: () => string | null) {
    this.batch = new EventCoalescer(events => this.show(events));
    hub.onEvent(event => {
      if (event.type === 'resolved') { this.close(event.alertId); return; }
      const decision = this.policy(event);
      this.decisions.push({ alertId: event.alertId, ...decision });
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
      title: multiple && conversations.length > 1 ? `${conversations.length} 个对话${allComplete ? '完成' : '有新进展'}` : conversationTitle(item, this.hub.snapshot()?.items),
      subtitle: multiple && conversations.length > 1 ? 'Pockymoe' : activitySecondary(item),
      body: multiple ? conversations.map(group => `${group.title} · ${group.items.map(activitySecondary).join('、')}`).slice(0, 3).join('；') : item.state === 'interrupted' ? `已中断${item.resultSummary ? ` · ${item.resultSummary}` : ''}` : item.request?.summary || item.resultSummary || (first.type === 'failed' ? '任务遇到了问题' : '任务已完成'),
      silent: !this.settings.get().petSound,
      ...(['darwin', 'win32'].includes(process.platform) && !multiple ? { actions: [
        ...(item.request?.kind === 'approval' ? [{ type: 'button' as const, text: '批准' }, { type: 'button' as const, text: '拒绝' }] : []),
        { type: 'button' as const, text: '在地图中显示' }
      ] } : {}),
      // Map every underlying alert id so acknowledgement closes the batch.
      ...(process.platform === 'win32' ? { timeoutType: 'default' as const } : {})
    });
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
    notification.on('close', () => { for (const event of events) if (this.active.get(event.alertId) === notification) this.active.delete(event.alertId); });
    notification.show();
  }
  dispose(): void { this.batch.dispose(); for (const n of new Set(this.active.values())) n.close(); }
}
