import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { expect, it, vi } from 'vitest';
import { LocalMessages } from '../src/main/messages';
const owner = (id: number): BrowserWindow => Object.assign(new EventEmitter(), { id, isDestroyed: () => false, show: vi.fn(), focus: vi.fn() }) as unknown as BrowserWindow;
it('serializes confirmations and ignores foreign, stale and invalid replies', async () => {
  const changed = vi.fn(), messages = new LocalMessages(changed), window = owner(1);
  const first = messages.show({ message: 'Download?', buttons: ['Download', 'Later'], cancelId: 1, defaultId: 1 }, window);
  const second = messages.show({ message: 'Restart?', buttons: ['Restart', 'Later'], cancelId: 1 }, window);
  await Promise.resolve();
  const prompt = messages.view(1)!;
  expect(prompt).toMatchObject({ message: 'Download?', cancelId: 1, defaultId: 1 });
  expect(messages.view(2)).toBeNull();
  for (const [windowId, id, response] of [[2, prompt.id, 0], [1, prompt.id + 1, 0], [1, prompt.id, -1], [1, prompt.id, 2], [1, prompt.id, NaN]]) expect(messages.respond(windowId, id, response)).toBe(false);
  expect(messages.respond(1, prompt.id, 0)).toBe(true);
  expect(await first).toEqual({ response: 0, checkboxChecked: false });
  await Promise.resolve();
  const next = messages.view(1)!;
  expect(next.message).toBe('Restart?');
  expect(next.defaultId).toBe(0);
  expect(messages.respond(1, prompt.id, 0)).toBe(false);
  expect(messages.respond(1, next.id, 1)).toBe(true);
  expect(await second).toEqual({ response: 1, checkboxChecked: false });
  expect(messages.view(1)).toBeNull(); expect(changed).toHaveBeenCalledTimes(4);
});
it('cancels when the owner hides or closes, and drains queued prompts on shutdown', async () => {
  for (const event of ['hide', 'closed']) {
    const messages = new LocalMessages(vi.fn()), window = owner(1);
    const answer = messages.show({ message: 'Restart?', buttons: ['Restart', 'Later'], cancelId: 1 }, window);
    await Promise.resolve(); window.emit(event);
    expect((await answer).response).toBe(1); expect(messages.view(1)).toBeNull();
    expect(window.listenerCount('closed')).toBe(0); expect(window.listenerCount('hide')).toBe(0);
  }
  const messages = new LocalMessages(vi.fn()), window = owner(1);
  const first = messages.show({ message: 'One', buttons: ['Yes', 'No'], cancelId: 1 }, window);
  const second = messages.show({ message: 'Two', buttons: ['Yes', 'No'], cancelId: 1 }, window);
  await Promise.resolve(); messages.dispose();
  expect((await first).response).toBe(1); expect((await second).response).toBe(1);
  expect(window.show).toHaveBeenCalledTimes(1);
});
