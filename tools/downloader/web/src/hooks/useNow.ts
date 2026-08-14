import { useEffect, useState } from "react";

/** Wall clock, re-rendered on an interval. Used for retention countdowns. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs]);
  return now;
}
