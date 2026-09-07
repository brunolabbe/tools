/**
 * What the pool says it is doing while a lease is waiting (dl-43).
 *
 * The defect this pins is a mis-report rather than a gap. The pool is bounded
 * by a semaphore, so a probe that arrives while every browser is busy *waits* —
 * and the analysing panel told it "Opening a headless browser", which is not
 * what is happening and does not explain why it is slow. Concurrency makes that
 * likeliest exactly when the user is least patient.
 *
 * **Playwright is mocked here, and `pool.test.ts` is where real launches live.**
 * The thing under test is the order of two callbacks around a semaphore, and a
 * real Chromium would add a second of launch time per case while proving
 * nothing extra about it — the launch either happened or the callback that
 * announces it did not fire. The mock's `launch` also lets a test hold the slot
 * without holding a browser.
 */

import { expect, test, vi } from "vitest";

vi.mock("playwright", () => ({
  chromium: {
    launch: () =>
      Promise.resolve({
        isConnected: () => true,
        close: () => Promise.resolve(),
        newContext: () => Promise.resolve({}),
      }),
  },
}));

const { BrowserPool } = await import("../../src/browser/pool.ts");

/** A promise plus the handle that settles it, for holding a slot open. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

test("a lease that waits for a slot says so, and does not claim to be opening a browser", async () => {
  const pool = new BrowserPool({ maxConcurrent: 1, headless: true });
  const held = gate();

  const first: string[] = [];
  const firstLease = pool.withBrowser({ onStage: (stage) => first.push(stage) }, async () => {
    await held.promise;
  });
  // Let the first lease take the only slot before the second asks for one.
  await Promise.resolve();

  const second: string[] = [];
  const secondLease = pool.withBrowser({ onStage: (stage) => second.push(stage) }, async () => {
    // Nothing: reaching here at all is the point.
  });

  // The queued lease has announced the wait and *only* the wait. This is the
  // assertion the ticket was filed for: no "opening a browser" while the truth
  // is "every browser is busy".
  expect(second).toEqual(["browser-slot"]);
  expect(second).not.toContain("browser-launch");

  // The uncontended lease is the control. It never claims to have waited,
  // because it did not — an unconditional emit would have put the queue copy on
  // screen for every probe, which is narration again by another name.
  expect(first).toEqual(["browser-launch"]);

  held.open();
  await firstLease;
  await secondLease;

  // And once the slot is handed over, the wait is followed by the launch.
  expect(second).toEqual(["browser-slot", "browser-launch"]);
  await pool.close();
});

test("a lease with no listener is unaffected", async () => {
  const pool = new BrowserPool({ maxConcurrent: 1, headless: true });
  const browser = await pool.withBrowser({}, async (leased) => leased);
  expect(browser.isConnected()).toBe(true);
  await pool.close();
});
