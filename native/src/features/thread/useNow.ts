import { useEffect, useState } from 'react';
/** The current time, ticking only while something shows elapsed time. */
export function useNow(intervalMs: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!intervalMs) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
