import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { DISPLAY_SLEEP_SCRIPT } from '../src/main/displaySleep';

it.skipIf(process.platform !== 'darwin')('observes display notifications using the macOS bridge without changing the real display', () => {
  // Posts only into this helper's own notification center, never the OS center.
  const script = DISPLAY_SLEEP_SCRIPT.replace('$.NSRunLoop.currentRunLoop.run;', `
    center.postNotificationNameObject($.NSWorkspaceScreensDidSleepNotification, $());
    center.postNotificationNameObject($.NSWorkspaceScreensDidWakeNotification, $());
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
  `);
  const output = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8', timeout: 5000 });
  expect(output.trim().split('\n').slice(-2)).toEqual(['asleep', 'awake']);
});
