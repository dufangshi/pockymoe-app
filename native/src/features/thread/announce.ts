// What the open thread tells a screen reader and the hand (T3's thread status announcements,
// the Web host's haptic contract): a new request taps for attention and is read out; a turn
// that ends is read out as finished or failed. Opening a thread is silent: the first
// snapshot only seeds the memory.
import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';

export interface ActivitySnapshot {
  running: boolean;
  /** Status of the newest non-local turn. */
  lastTurnStatus: string | null;
  requestIds: readonly string[];
}
export type ActivityChange = 'request' | 'finished' | 'failed' | null;

export function activityChange(previous: ActivitySnapshot | null, next: ActivitySnapshot): ActivityChange {
  if (!previous) return null;
  if (next.requestIds.some(id => !previous.requestIds.includes(id))) return 'request';
  if (previous.running && !next.running) {
    if (next.lastTurnStatus === 'failed') return 'failed';
    if (next.lastTurnStatus === 'interrupted') return null;
    return 'finished';
  }
  return null;
}

export function useActivityAnnouncements(threadKey: string, snapshot: ActivitySnapshot | null) {
  const memory = useRef<{ key: string; snapshot: ActivitySnapshot } | null>(null);
  const requestKey = snapshot?.requestIds.join(',') ?? '';
  useEffect(() => {
    if (!snapshot) return;
    const previous = memory.current?.key === threadKey ? memory.current.snapshot : null;
    memory.current = { key: threadKey, snapshot };
    const change = activityChange(previous, snapshot);
    if (change === 'request') { haptic.attention(); AccessibilityInfo.announceForAccessibility(translate('native.notifyWaiting')); }
    else if (change === 'failed') AccessibilityInfo.announceForAccessibility(translate('native.notifyFailed'));
    else if (change === 'finished') AccessibilityInfo.announceForAccessibility(translate('native.notifyDone'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadKey, snapshot?.running, snapshot?.lastTurnStatus, requestKey]);
}
