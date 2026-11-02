import type { ActivityEvent, DesktopSettings } from '../shared/contract';
import { isAgentActivity } from '../shared/activityGroups';
import { isMuted } from '../shared/mutes';
/** Agent preferences apply only to terminal events; waiting requests must remain actionable. */
export function agentAlertPolicy(event: ActivityEvent, settings: DesktopSettings): { alert: boolean; voice: boolean } {
  const mode = isAgentActivity(event.item) && ['completed', 'failed'].includes(event.type) ? settings.petAgentAlerts ?? 'all' : 'all';
  return { alert: mode !== 'off', voice: mode === 'all' };
}
export interface DeliveryContext {
  settings: DesktopSettings; focused: boolean; focusedThreadKey: string | null;
  petVisible: boolean; idleSeconds: number; now?: number; doNotDisturb?: boolean;
}
export function deliveryPolicy(event: ActivityEvent, c: DeliveryContext): { pet: boolean; system: boolean } {
  const none = { pet: false, system: false };
  if (!agentAlertPolicy(event, c.settings).alert || ['started', 'resolved'].includes(event.type) || (c.focused && c.focusedThreadKey === event.item.key) ||
      (c.settings.snoozeUntil && Date.parse(c.settings.snoozeUntil) > (c.now ?? Date.now())) ||
      (event.type === 'completed' && c.settings.petMuteAlerts && isMuted(event.item, c.settings.petMutes))) return none;
  return {
    pet: c.settings.alertMode !== 'system' && c.petVisible && !c.doNotDisturb,
    system: c.settings.alertMode === 'system' || c.settings.alertMode === 'both' || !c.petVisible || c.idleSeconds >= 120 || event.type === 'needsInput'
  };
}
export class EventCoalescer {
  private pending: ActivityEvent[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private deliver: (events: ActivityEvent[]) => void, private delay = 1500) {}
  add(event: ActivityEvent): void {
    this.pending.push(event);
    this.timer ??= setTimeout(() => this.flush(), this.delay);
  }
  remove(id: string): void { this.pending = this.pending.filter(e => e.alertId !== id); }
  flush(): void {
    clearTimeout(this.timer); this.timer = undefined;
    const events = this.pending; this.pending = [];
    if (events.length > 2) this.deliver(events);
    else for (const event of events) this.deliver([event]);
  }
  dispose(): void { clearTimeout(this.timer); this.timer = undefined; this.pending = []; }
}
