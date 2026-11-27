// Focus a text field once a sheet has finished rising. `autoFocus` inside a Modal is
// unreliable on Android (the view is not attached yet), so focus after the animation.
import { useEffect, type RefObject } from 'react';

export function useFocusWhen(ref: RefObject<{ focus(): void } | null>, when: boolean, delay = 320) {
  useEffect(() => {
    if (!when) return;
    const timer = setTimeout(() => ref.current?.focus(), delay);
    return () => clearTimeout(timer);
  }, [ref, when, delay]);
}
