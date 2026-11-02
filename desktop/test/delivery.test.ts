import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentAlertPolicy, deliveryPolicy, EventCoalescer, type DeliveryContext } from '../src/main/delivery';
import { defaults } from '../src/main/store';
import { event } from './fixtures';
const context = (patch: Partial<DeliveryContext> = {}): DeliveryContext => ({ settings: defaults, focused: false, focusedThreadKey: null, petVisible: true, idleSeconds: 0, ...patch });
describe('delivery policy table', () => {
  it.each([
    [true, 0, 'completed', true, false], [true, 119, 'failed', true, false], [true, 0, 'needsInput', true, true],
    [true, 120, 'completed', true, true], [false, 0, 'completed', false, true], [false, 120, 'needsInput', false, true]
  ] as const)('pet visible=%s, idle=%s, event=%s', (petVisible, idleSeconds, type, pet, system) => {
    expect(deliveryPolicy(event({ type }), context({ petVisible, idleSeconds }))).toEqual({ pet, system });
  });
  it.each(['petFirst', 'system', 'both'] as const)('always suppresses the focused thread and snoozed alerts in %s', alertMode => {
    const settings = { ...defaults, alertMode };
    expect(deliveryPolicy(event(), context({ settings, focused: true, focusedThreadKey: 'mac:thread-1' }))).toEqual({ pet: false, system: false });
    expect(deliveryPolicy(event(), context({ settings: { ...settings, snoozeUntil: '2100-01-01T00:00:00Z' } }))).toEqual({ pet: false, system: false });
  });
  it('supports explicit system/both modes, DND and non-alert transitions', () => {
    expect(deliveryPolicy(event(), context({ settings: { ...defaults, alertMode: 'system' } }))).toEqual({ pet: false, system: true });
    expect(deliveryPolicy(event(), context({ settings: { ...defaults, alertMode: 'both' } }))).toEqual({ pet: true, system: true });
    expect(deliveryPolicy(event(), context({ doNotDisturb: true, idleSeconds: 120 }))).toEqual({ pet: false, system: true });
    for (const type of ['started', 'resolved'] as const) expect(deliveryPolicy(event({ type }), context())).toEqual({ pet: false, system: false });
  });
});
describe('burst coalescing', () => {
  afterEach(() => vi.useRealTimers());
  it('coalesces more than two events in 1.5 seconds and cancels acknowledged alerts', () => {
    vi.useFakeTimers(); const deliver = vi.fn(), batch = new EventCoalescer(deliver);
    batch.add(event({ alertId: '1' })); vi.advanceTimersByTime(500);
    batch.add(event({ alertId: '2' })); batch.add(event({ alertId: '3' }));
    vi.advanceTimersByTime(999); expect(deliver).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(deliver).toHaveBeenCalledTimes(1); expect(deliver.mock.calls[0][0]).toHaveLength(3);
    batch.add(event({ alertId: '4' })); batch.add(event({ alertId: '5' })); batch.remove('4');
    vi.advanceTimersByTime(1500); expect(deliver.mock.calls[1][0].map((e: { alertId: string }) => e.alertId)).toEqual(['5']);
  });
  it('keeps one or two distinct alerts and discards pending on disposal', () => {
    vi.useFakeTimers(); const deliver = vi.fn(), batch = new EventCoalescer(deliver);
    batch.add(event()); batch.add(event({ alertId: 'second' })); vi.advanceTimersByTime(1500);
    expect(deliver).toHaveBeenCalledTimes(2);
    batch.add(event()); batch.dispose(); vi.advanceTimersByTime(1500); expect(deliver).toHaveBeenCalledTimes(2);
    batch.add(event()); vi.advanceTimersByTime(1500); expect(deliver).toHaveBeenCalledTimes(3);
  });
});

describe('agent alert preferences', () => {
  it.each(['all', 'silent', 'off'] as const)('%s covers every event and leaves root events alone', petAgentAlerts => {
    const settings = { ...defaults, petAgentAlerts, alertMode: 'both' as const };
    for (const type of ['started', 'resolved', 'completed', 'failed', 'needsInput'] as const) {
      const agent = event({ type, item: { ...event().item, rootThreadKey: 'mac:root' } });
      const terminal = type === 'completed' || type === 'failed';
      expect(agentAlertPolicy(agent, settings)).toEqual({ alert: !terminal || petAgentAlerts !== 'off', voice: !terminal || petAgentAlerts === 'all' });
      const show = !['started', 'resolved'].includes(type) && (!terminal || petAgentAlerts !== 'off');
      expect(deliveryPolicy(agent, context({ settings }))).toEqual({ pet: show, system: show });
      expect(deliveryPolicy(event({ type }), context({ settings }))).toEqual({ pet: !['started', 'resolved'].includes(type), system: !['started', 'resolved'].includes(type) });
    }
  });
  it('defaults missing values to all and keeps stricter mute rules', () => {
    const agent = event({ item: { ...event().item, rootThreadKey: 'mac:root' } });
    expect(agentAlertPolicy(agent, { ...defaults, petAgentAlerts: undefined } as unknown as typeof defaults)).toEqual({ alert: true, voice: true });
    for (const petAgentAlerts of ['all', 'silent', 'off'] as const) {
      expect(deliveryPolicy(agent, context({ settings: { ...defaults, petAgentAlerts, petMuteAlerts: true, petMutes: [{ kind: 'thread', id: 'mac:root', label: 'root' }] } }))).toEqual({ pet: false, system: false });
    }
  });
});
