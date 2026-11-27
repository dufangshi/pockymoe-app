// Fold posture from the native module (Jetpack WindowManager on Android). Without the
// module (iOS, older builds) the layout simply has no hinge.
import { requireOptionalNativeModule } from 'expo-modules-core';
import { foldStore } from '../../layout/layout';

interface PockymoeNative {
  addListener(event: 'fold', listener: (e: { hingeX: number | null; separating: boolean }) => void): { remove(): void };
  startFoldUpdates?(): void;
  startThreadWatch?(relay: string, token: string, scheme: string, texts: Record<string, string>): boolean;
  stopThreadWatch?(): void;
  rememberThreadNames?(names: Record<string, string>): void;
}
export const pockymoeNative = requireOptionalNativeModule<PockymoeNative>('PockymoeNative');
const native = pockymoeNative;

export function startFoldObserver() {
  if (!native) return () => undefined;
  const sub = native.addListener('fold', e => { if (__DEV__) console.log('[fold]', JSON.stringify(e)); foldStore.set({ hingeX: e.hingeX, separating: e.separating }); });
  native.startFoldUpdates?.();
  return () => sub.remove();
}
