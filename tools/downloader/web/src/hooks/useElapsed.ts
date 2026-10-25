import { useEffect, useState } from "react";

/** Milliseconds since `startedAt`, ticking while it is not `null`. */
export function useElapsed(startedAt: number | null, intervalMs = 250): number {
  // The clock is what state holds, and the elapsed time is derived from it in
  // render: a hook that set `elapsed` from its own effect would paint one frame
  // of the old value first, and `startedAt` going `null` would need a second
  // `setState` to say zero. While nothing is timing the interval is off and
  // `now` goes stale, which is why the difference is clamped — a `startedAt`
  // newer than `now` is a clock that has not ticked since it began, so zero.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [startedAt, intervalMs]);

  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}
