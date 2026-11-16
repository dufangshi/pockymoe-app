import { spawn } from 'node:child_process';

// NSWorkspace provides display sleep/wake notifications that Electron's
// powerMonitor omits. JXA is built into macOS and needs no accessibility or
// automation permission; this listener never controls another application.
export const DISPLAY_SLEEP_SCRIPT = `
ObjC.import('AppKit'); ObjC.import('CoreGraphics');
function report(awake) {
  $.NSFileHandle.fileHandleWithStandardOutput.writeData($(awake ? 'awake\\n' : 'asleep\\n').dataUsingEncoding($.NSUTF8StringEncoding));
}
var center = $.NSWorkspace.sharedWorkspace.notificationCenter;
var asleep = center.addObserverForNameObjectQueueUsingBlock($.NSWorkspaceScreensDidSleepNotification, $(), $.NSOperationQueue.mainQueue, function () { report(false); });
var awake = center.addObserverForNameObjectQueueUsingBlock($.NSWorkspaceScreensDidWakeNotification, $(), $.NSOperationQueue.mainQueue, function () { report(true); });
report(!$.CGDisplayIsAsleep($.CGMainDisplayID()));
$.NSRunLoop.currentRunLoop.run;
`;

export function watchDisplaySleep(receive: (awake: boolean) => void): () => void {
  if (process.platform !== 'darwin') return () => {};
  const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', DISPLAY_SLEEP_SCRIPT], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf('\n'); if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (line === 'awake' || line === 'asleep') receive(line === 'awake');
    }
  });
  child.on('error', () => { /* Lock/suspend/idle still work if the OS helper is unavailable. */ });
  return () => { child.stdout.removeAllListeners(); child.kill(); };
}
