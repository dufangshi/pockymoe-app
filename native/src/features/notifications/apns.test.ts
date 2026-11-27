import { describe, expect, it } from 'vitest';
import { apnsSubscription, noticeFields, noticeTarget } from './apns';

describe('APNs through the relay', () => {
  it('builds the subscription the relay validates', () => {
    expect(apnsSubscription('AB'.repeat(32), 'https://relay.example.com', 'development')).toEqual({
      nativePlatform: 'apns', appKind: 'ios', deviceToken: 'ab'.repeat(32), relayOrigin: 'https://relay.example.com/', sandbox: true });
    expect(apnsSubscription('ab'.repeat(32), 'https://relay.example.com/', 'production').sandbox).toBe(false);
  });
  it('opens the thread of a relay push (payload keys outside aps)', () => {
    // The payload relay apns.rs native_payload sends.
    const payload = { aps: { alert: { title: 'Fix login', body: 'A turn finished.' }, sound: 'default', 'thread-id': 'dev1:th1' },
      deviceId: 'dev1', threadId: 'th1', eventId: 'e', tag: 'e', url: '/devices/dev1/threads/th1', relayOrigin: 'https://relay.example.com/' };
    expect(noticeTarget(noticeFields({ type: 'push', payload }, null))).toEqual({ deviceKey: 'relay:dev1', threadId: 'th1' });
  });
  it('opens the thread of a local notice', () => {
    expect(noticeTarget(noticeFields(null, { deviceKey: 'direct:http://h:1', threadId: 't' }))).toEqual({ deviceKey: 'direct:http://h:1', threadId: 't' });
    expect(noticeTarget(noticeFields(null, {}))).toBeNull();
  });
});
