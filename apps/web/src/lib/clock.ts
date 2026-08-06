/**
 * Injectable time source.
 *
 * `schedule` returns a canceller rather than a handle on purpose: the handle
 * type differs between the DOM (`number`) and node (`Timeout`), and this module
 * is imported by both the browser bundle and the node test suite.
 */
export interface Clock {
  /** Runs `fn` after `ms`. Calling the returned function cancels it. */
  schedule(fn: () => void, ms: number): () => void;
  now(): number;
}

export const systemClock: Clock = {
  schedule(fn, ms) {
    const handle = setTimeout(fn, ms);
    return () => {
      clearTimeout(handle);
    };
  },
  now: () => Date.now(),
};

export function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => {
    clock.schedule(() => resolve(), ms);
  });
}
