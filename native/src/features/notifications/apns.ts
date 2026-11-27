// Pure parts of iOS push through the relay (docs/thread-notifications.md; relay apns.rs).

/** The relay's native push subscription (relay apns.rs `Subscription`). Development builds hold
 *  tokens of Apple's sandbox; preview and release builds use production APNs. */
export function apnsSubscription(deviceToken: string, origin: string, variant: string) {
  return { nativePlatform: 'apns', appKind: 'ios', deviceToken: deviceToken.toLowerCase(), relayOrigin: `${new URL(origin).origin}/`, sandbox: variant === 'development' };
}

/** A notice's fields. A remote (APNs) push keeps the relay's keys at the top of its payload,
 *  which expo-notifications leaves in `trigger.payload` (its `data` is only `body`). */
export function noticeFields(trigger: unknown, data: unknown): Record<string, unknown> {
  const t = trigger as { type?: string; payload?: Record<string, unknown> } | null;
  const own = (data ?? {}) as Record<string, unknown>;
  return t?.type === 'push' ? { ...(t.payload ?? {}), ...own } : own;
}

/** The thread a tapped notice opens: local notices carry `deviceKey`, the relay's APNs payload
 *  `deviceId` (a relay device). */
export function noticeTarget(fields: Record<string, unknown>): { deviceKey: string; threadId: string } | null {
  const threadId = typeof fields.threadId === 'string' ? fields.threadId : null;
  const deviceKey = typeof fields.deviceKey === 'string' ? fields.deviceKey : typeof fields.deviceId === 'string' ? `relay:${fields.deviceId}` : null;
  return deviceKey && threadId ? { deviceKey, threadId } : null;
}
