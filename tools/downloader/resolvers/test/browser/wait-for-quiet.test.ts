/**
 * `waitForQuiet`'s floor against its deadline (dl-80), with no browser.
 *
 * The end-to-end specs take seconds per case and, at the shipped budgets, leave
 * the floor ending 0.4 s before the deadline, so a floor that ignored the
 * deadline passed them all. Here the collector is a stand-in and the clock is
 * the only real thing, which makes the competing case cost a third of a second.
 */

import { describe, expect, test } from "vitest";
import type { HitCollector } from "../../src/browser/intercept.ts";
import { waitForQuiet } from "../../src/browser/provoke.ts";

/**
 * Only the two members `waitForQuiet` reads. `HitCollector` has private fields,
 * so a structural stand-in needs the cast; no other member is touched.
 */
function standIn(hasPlayableHit: boolean): HitCollector {
  return {
    // Quiet since long before the wait began: only the floor can hold it.
    lastActivityAt: Date.now() - 60_000,
    hasPlayableHit: () => hasPlayableHit,
  } as unknown as HitCollector;
}

async function wait(
  collector: HitCollector,
  deadlineInMs: number,
): Promise<{ quiet: boolean; elapsedMs: number }> {
  const startedAt = Date.now();
  const quiet = await waitForQuiet({
    collector,
    deadline: startedAt + deadlineInMs,
    quietMs: 100,
    minWaitMs: 100,
    emptyMinWaitMs: 1000,
    signal: new AbortController().signal,
  });
  return { quiet, elapsedMs: Date.now() - startedAt };
}

describe("waitForQuiet's empty floor against the deadline (dl-80)", () => {
  test("a deadline shorter than the floor wins, and the wait reports it did not go quiet", async () => {
    const { quiet, elapsedMs } = await wait(standIn(false), 300);

    // `false` is what separates TIMEOUT from NO_MEDIA_FOUND downstream.
    expect(quiet).toBe(false);
    expect(elapsedMs).toBeLessThan(1000);
  });

  test("with nothing playable the floor holds a wait whose deadline allows it", async () => {
    const { quiet, elapsedMs } = await wait(standIn(false), 5000);

    expect(quiet).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(1000);
  });

  test("a playable hit drops the floor to the standard minimum wait", async () => {
    const { quiet, elapsedMs } = await wait(standIn(true), 5000);

    expect(quiet).toBe(true);
    expect(elapsedMs).toBeLessThan(1000);
  });
});
