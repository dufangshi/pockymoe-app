// Hardware keyboard shortcuts (T3's keyboard commands). The native view around the app
// (modules/pockymoe-native, PockymoeKeyCommands) reports only commands some screen has
// registered, so other keys reach text fields untouched. The newest registration of a command
// wins: a pushed page over the list takes `back` and `send`.
import { useEffect, useRef, useSyncExternalStore, type PropsWithChildren } from 'react';
import { View, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { requireNativeView } from 'expo';
import { requireOptionalNativeModule } from 'expo-modules-core';

/** Ctrl/Cmd shortcuts, and plain list keys (arrows, Home, End, Enter) that only reach a
 *  handler when no text field or other view took them. */
export type KeyCommand = 'send' | 'newThread' | 'search' | 'back' | 'git' | 'files'
  | 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'enter';

const handlers = new Map<KeyCommand, Array<{ run: () => boolean | void }>>();
const listeners = new Set<() => void>();
let enabled: KeyCommand[] = [];
const publish = () => { enabled = [...handlers.keys()]; listeners.forEach(l => l()); };

/** Registers a shortcut handler while the component is mounted and `active`. */
export function useKeyCommand(command: KeyCommand, run: () => boolean | void, active = true) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!active) return;
    const entry = { run: () => latest.current() };
    handlers.set(command, [...(handlers.get(command) ?? []), entry]);
    publish();
    return () => {
      const rest = (handlers.get(command) ?? []).filter(e => e !== entry);
      if (rest.length) handlers.set(command, rest); else handlers.delete(command);
      publish();
    };
  }, [command, active]);
}

export function runKeyCommand(command: KeyCommand) {
  const stack = handlers.get(command) ?? [];
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.run() !== false) return true;
  return false;
}

interface NativeProps extends ViewProps { enabledCommands: KeyCommand[]; takesKeys?: boolean; onCommand: (e: NativeSyntheticEvent<{ command: KeyCommand }>) => void }
const Native = requireOptionalNativeModule('PockymoeKeyCommands') ? requireNativeView<NativeProps>('PockymoeKeyCommands') : null;

/** Around the app, and again inside a Modal (`scope`): a Modal is its own window, so keys
 *  there never reach the app's view. */
export function KeyCommandsRoot({ children, scope = false }: PropsWithChildren<{ scope?: boolean }>) {
  const commands = useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => enabled);
  if (!Native) return scope ? <View style={{ flex: 1 }}>{children}</View> : <>{children}</>;
  return <Native style={{ flex: 1 }} enabledCommands={commands} takesKeys={scope} onCommand={e => { runKeyCommand(e.nativeEvent.command); }}>{children}</Native>;
}
