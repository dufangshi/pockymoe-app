import { describe, expect, it } from 'vitest';
import type { ActivityItem } from '../shared/contract';
import { speechSurfaceSide } from './geometry';
import { SPEECH_LINGER_MS, SPEECH_MAX_MS, speechPresentation, SpeechTracker } from './speechBubble';

const item = (key = 'd:t', rootThreadKey?: string): ActivityItem => ({
  key,
  deviceId: 'd',
  deviceName: 'Mac',
  workspaceId: 'w',
  workspaceLabel: 'repo',
  threadId: key.slice(2),
  title: key,
  rootThreadKey,
  state: 'idle',
  since: '2026-11-08T00:00:00Z',
  unread: true,
});

describe('speech tracker', () => {
  it('shows a line only once its audio starts, and keeps it briefly after it ends', () => {
    const speech = new SpeechTracker();
    const id = speech.prepare(item(), 'done');
    expect(speech.current).toBeNull();
    expect(speech.started(id, 0)).toBe(true);
    expect(speech.current).toMatchObject({ text: 'done', playing: true });
    speech.ended(id, 1000);
    expect(speech.current?.playing).toBe(false);
    speech.tick(1000 + SPEECH_LINGER_MS - 1, false);
    expect(speech.current).not.toBeNull();
    speech.tick(1000 + SPEECH_LINGER_MS, false);
    expect(speech.current).toBeNull();
  });

  it('stays while the pointer is near, then gets the full linger again', () => {
    const speech = new SpeechTracker();
    const id = speech.prepare(item(), 'done');
    speech.started(id, 0);
    speech.ended(id, 0);
    speech.tick(60_000, true);
    speech.tick(60_000 + SPEECH_LINGER_MS - 1, false);
    expect(speech.current).not.toBeNull();
    speech.tick(60_000 + SPEECH_LINGER_MS, false);
    expect(speech.current).toBeNull();
  });

  it('follows the newest line when older audio is cut off, whichever report arrives first', () => {
    const speech = new SpeechTracker();
    const first = speech.prepare(item('d:a'), 'a');
    speech.started(first, 0);
    const second = speech.prepare(item('d:b'), 'b');
    expect(speech.started(second, 10)).toBe(true);
    speech.ended(first, 11);
    expect(speech.current).toMatchObject({ text: 'b', playing: true });
  });

  it('ignores a line superseded before it started, and clears on account change', () => {
    const speech = new SpeechTracker();
    const first = speech.prepare(item('d:a'), 'a');
    const second = speech.prepare(item('d:b'), 'b');
    expect(speech.started(first, 0)).toBe(false);
    expect(speech.current).toBeNull();
    expect(speech.started(second, 0)).toBe(true);
    speech.clear();
    expect(speech.current).toBeNull();
    expect(speech.started(second, 0)).toBe(false);
  });

  it('goes when its thread is opened, without losing a line about to start', () => {
    const speech = new SpeechTracker();
    speech.started(speech.prepare(item('d:agent', 'd:t'), 'a'), 0);
    const next = speech.prepare(item('d:b'), 'b');
    speech.dismiss({ key: 'd:other' });
    expect(speech.current).not.toBeNull();
    speech.dismiss({ key: 'd:t' });
    expect(speech.current).toBeNull();
    expect(speech.started(next, 1)).toBe(true);
  });

  it('does not stay forever if the renderer never reports the end', () => {
    const speech = new SpeechTracker();
    speech.started(speech.prepare(item(), 'a'), 0);
    speech.tick(SPEECH_MAX_MS - 1, false);
    expect(speech.current?.playing).toBe(true);
    speech.tick(SPEECH_MAX_MS, false);
    expect(speech.current?.playing).toBe(false);
    speech.tick(SPEECH_MAX_MS + SPEECH_LINGER_MS, false);
    expect(speech.current).toBeNull();
  });
});

describe('speech presentation', () => {
  const events = (...keys: string[]) => keys.map((key) => ({ item: item(key) }));
  it('stands alone, or stands in for the same thread\'s pill', () => {
    expect(speechPresentation(null, null)).toBe('none');
    expect(speechPresentation({ item: item() }, null)).toBe('line');
    expect(speechPresentation({ item: item() }, { sticky: false, events: events('d:t') })).toBe('replace');
  });
  it('treats an agent thread as part of its conversation', () => {
    const agent = item('d:agent', 'd:t');
    expect(speechPresentation({ item: agent }, { sticky: false, events: events('d:t') })).toBe('replace');
  });
  it('never moves a request\'s buttons: it marks that bubble, or sits above another', () => {
    expect(speechPresentation({ item: item() }, { sticky: true, events: events('d:t') })).toBe('mark');
    expect(speechPresentation({ item: item() }, { sticky: true, events: events('d:other') })).toBe('line');
  });
  it('names one thread above a burst of finished threads', () => {
    expect(speechPresentation({ item: item() }, { sticky: false, events: events('d:t', 'd:b') })).toBe('line');
  });
});

describe('speech surface side', () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 };
  it('goes over her head when it fits, otherwise below', () => {
    expect(speechSurfaceSide({ x: 0, y: 300, width: 190, height: 200 }, area, 28)).toBe('above');
    expect(speechSurfaceSide({ x: 0, y: 10, width: 190, height: 200 }, area, 28)).toBe('below');
  });
});
