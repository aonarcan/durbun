import { useEffect, useState } from 'react';

/** Current time, refreshed every `everyMs`, so "3 minutes ago" labels stay true. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
