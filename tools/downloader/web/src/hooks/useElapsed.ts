import { useEffect, useState } from "react";

/** Milliseconds since `startedAt`, ticking while `active`. */
export function useElapsed(startedAt: number | null, intervalMs = 250): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (startedAt === null) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - startedAt);
    const handle = setInterval(() => setElapsed(Date.now() - startedAt), intervalMs);
    return () => clearInterval(handle);
  }, [startedAt, intervalMs]);

  return elapsed;
}
