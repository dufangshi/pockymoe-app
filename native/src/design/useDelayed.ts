import { useEffect, useState } from 'react';
/** True once `value` has stayed true for `ms` (a disconnect shows after ~2.5 s, §6). */
export function useDelayed(value: boolean, ms = 2500) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!value) { setShown(false); return; }
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return shown;
}
