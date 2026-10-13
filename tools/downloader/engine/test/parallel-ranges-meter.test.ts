/**
 * dl-114: the feeder's rate meter without a socket. Every `Meter` method takes
 * `now`, so the arithmetic that `parallel-ranges.test.ts` proves in real time
 * (the F9 tests, seconds each) is a sequence of calls here. That file keeps the
 * wiring: that the feeder calls `pause`, `resume` and `release` at the right
 * moments. This one keeps what those calls add up to.
 *
 * Times are milliseconds on a clock the test owns; bytes are arbitrary.
 */

import { describe, expect, test } from "vitest";
import { Meter } from "../src/download/parallel-ranges.ts";

/** A fetch, as far as the meter knows: an identity. */
function fetchKey(): object {
  return {};
}

describe("Meter: what counts as time spent reading", () => {
  test("the first byte starts the clock and counts nothing, so an idle meter reads 0", () => {
    const meter = new Meter();
    expect(meter.rate()).toBe(0);
    meter.record(fetchKey(), 1000, 0);
    expect({ bytes: meter.bytes, activeMs: meter.activeMs, rate: meter.rate() }).toEqual({
      bytes: 0,
      activeMs: 0,
      rate: 0,
    });
  });

  test("each later byte counts the interval since the one before, and the rate is bytes over that time", () => {
    const meter = new Meter();
    const a = fetchKey();
    meter.record(a, 1000, 0);
    meter.record(a, 1000, 100);
    meter.record(a, 1000, 200);
    expect({ bytes: meter.bytes, activeMs: meter.activeMs }).toEqual({
      bytes: 2000,
      activeMs: 200,
    });
    expect(meter.rate()).toBe(10_000);
  });

  test("a pause inside an interval is taken out of that interval, not the interval thrown away", () => {
    const meter = new Meter();
    const a = fetchKey();
    meter.record(a, 1000, 0);
    meter.record(a, 1000, 100);
    meter.pause(a, 150);
    meter.resume(a, 350);
    // 100 to 400 is 300 ms, 200 of them paused.
    meter.record(a, 1000, 400);
    expect({ bytes: meter.bytes, activeMs: meter.activeMs }).toEqual({
      bytes: 2000,
      activeMs: 200,
    });
    expect(meter.rate()).toBe(10_000);
  });

  test("a byte that arrives during a pause ends it: the reader is back", () => {
    const meter = new Meter();
    const a = fetchKey();
    meter.record(a, 1000, 0);
    meter.record(a, 1000, 100);
    meter.pause(a, 150);
    meter.record(a, 1000, 300);
    // 100 to 300 is 200 ms, 150 of them paused.
    expect(meter.activeMs).toBe(150);
    meter.record(a, 1000, 400);
    expect(meter.activeMs).toBe(250);
  });

  test("a pause for a fetch the meter does not know is ignored", () => {
    const meter = new Meter();
    const a = fetchKey();
    meter.pause(fetchKey(), 50);
    meter.record(a, 1000, 0);
    meter.record(a, 1000, 100);
    meter.pause(fetchKey(), 150);
    meter.record(a, 1000, 300);
    expect(meter.activeMs).toBe(300);
  });

  test("interrupt drops the next interval, and the byte that ends it, but not the ones after", () => {
    const meter = new Meter();
    const a = fetchKey();
    meter.record(a, 1000, 0);
    meter.record(a, 1000, 100);
    meter.interrupt();
    meter.record(a, 1000, 5000);
    expect({ bytes: meter.bytes, activeMs: meter.activeMs }).toEqual({
      bytes: 1000,
      activeMs: 100,
    });
    meter.record(a, 1000, 5100);
    expect({ bytes: meter.bytes, activeMs: meter.activeMs }).toEqual({
      bytes: 2000,
      activeMs: 200,
    });
  });

  test("reset forgets the bytes, the time and who was being measured", () => {
    const meter = new Meter();
    const a = fetchKey();
    meter.record(a, 1000, 0);
    meter.record(a, 1000, 100);
    meter.reset();
    expect({ bytes: meter.bytes, activeMs: meter.activeMs, rate: meter.rate() }).toEqual({
      bytes: 0,
      activeMs: 0,
      rate: 0,
    });
    // `a` is no longer a member, so pausing it starts no pause.
    meter.pause(a, 150);
    meter.record(a, 1000, 200);
    meter.record(a, 1000, 300);
    expect(meter.activeMs).toBe(100);
  });
});

describe("Meter: the F9 cases (dl-98 round 2), as arithmetic", () => {
  test("a paused fetch that is left open does not stop the meter for one that is reading", () => {
    const meter = new Meter();
    const a = fetchKey();
    const b = fetchKey();
    meter.record(a, 1000, 0);
    meter.record(a, 1000, 100);
    meter.pause(a, 200);
    // B starts reading while A is still open and paused: not every member is
    // paused any more, so the pause ends at B's first byte.
    meter.record(b, 1000, 300);
    const before = meter.activeMs;
    meter.record(b, 1000, 400);
    meter.record(b, 1000, 500);
    // A meter frozen by A's pause would not have moved.
    expect(meter.activeMs - before).toBe(200);
  });

  test("the meter is paused only while every fetch it measures is", () => {
    const meter = new Meter();
    const a = fetchKey();
    const b = fetchKey();
    meter.record(a, 1000, 0);
    meter.record(b, 1000, 100);
    meter.pause(a, 150);
    meter.pause(b, 200);
    meter.resume(b, 1200);
    // 100 to 1300 is 1200 ms; both were paused from 200 to 1200.
    meter.record(b, 1000, 1300);
    expect(meter.activeMs).toBe(300);
  });

  test("a paused fetch that ffmpeg closed does not keep the meter paused for the next one", () => {
    const meter = new Meter();
    const a = fetchKey();
    const b = fetchKey();
    meter.record(a, 1000, 0);
    meter.record(a, 1000, 100);
    meter.pause(a, 200);
    meter.release(a, 1200);
    // The first interval of B's own: 100 to 1300, less the 1000 ms A spent
    // paused and then released. Its 100 ms of silence after the release counts
    // (see the gap rule below).
    meter.record(b, 1000, 1300);
    expect(meter.activeMs).toBe(300);
    const before = meter.activeMs;
    meter.record(b, 1000, 1400);
    // Before the fix A stayed in the paused set after its release, so B's
    // arrival made "every member paused" true and the meter stood still for good.
    expect(meter.activeMs - before).toBe(100);
  });

  test("a fetch ffmpeg closed while it was reading does not make a later pause the origin's time", () => {
    const meter = new Meter();
    const a = fetchKey();
    const b = fetchKey();
    meter.record(a, 1000, 0);
    meter.record(a, 1000, 100);
    meter.release(a, 150);
    meter.record(b, 1000, 200);
    meter.record(b, 1000, 300);
    expect(meter.activeMs).toBe(300);
    // B stops for 8 s, then reads on.
    meter.pause(b, 400);
    meter.resume(b, 8400);
    meter.record(b, 1000, 8500);
    // 300 to 8500 is 8200 ms; 8000 of them paused.
    expect(meter.activeMs).toBe(500);
  });

  test("the same pause is charged to the origin when the closed fetch was never released", () => {
    // What `release` prevents, as the control for the test above: A stays a
    // member that is never paused, so B alone paused is not "every member".
    const meter = new Meter();
    const a = fetchKey();
    const b = fetchKey();
    meter.record(a, 1000, 0);
    meter.record(a, 1000, 100);
    meter.record(b, 1000, 200);
    meter.record(b, 1000, 300);
    meter.pause(b, 400);
    meter.resume(b, 8400);
    meter.record(b, 1000, 8500);
    expect(meter.activeMs).toBe(8500);
  });
});

describe("Meter: the gap after the last fetch is released (owner's decision, 2026-10-13)", () => {
  /**
   * An 8 MB/s origin against 5 MB/s of media: 80 kB every 10 ms. A is read for
   * 0.5 s and closed. B's first byte comes `gapMs` later, and the feeder judges
   * at the first byte that takes the measured time to 1500 ms.
   */
  function judge(gapMs: number): { bytes: number; activeMs: number; fast: boolean } {
    const mediaBytesPerSecond = 5_000_000;
    const windowMs = 1500;
    const meter = new Meter();
    const a = fetchKey();
    const b = fetchKey();
    for (let at = 0; at <= 500; at += 10) meter.record(a, 80_000, at);
    meter.release(a, 500);
    for (let at = 500 + gapMs; meter.activeMs < windowMs; at += 10) meter.record(b, 80_000, at);
    return {
      bytes: meter.bytes,
      activeMs: meter.activeMs,
      fast: meter.rate() >= mediaBytesPerSecond,
    };
  }

  // **This pins today's rule, option (a) of dl-114's question; it does not
  // endorse it.** `record` adds `now - lastAt - paused`. Once `release` has
  // emptied the members nothing is paused and nothing is being read, so the
  // whole wait for the next fetch's first byte counts as the origin's time, with
  // one chunk in it. First-byte latency is arguably the origin's, which is the
  // case for leaving it. The cost is the third row: a fast origin whose next
  // request answers a second late is judged slow and split. Option (b) had
  // `release` of the last member call `interrupt()`; that changes production
  // behaviour, so it is a ticket of its own, and when it lands this table is the
  // one that changes.
  test.each([
    [0, { bytes: 12_080_000, activeMs: 1500, fast: true }],
    [300, { bytes: 9_680_000, activeMs: 1500, fast: true }],
    [1000, { bytes: 4_080_000, activeMs: 1500, fast: false }],
  ] as const)("a gap of %i ms before B's first byte", (gapMs, expected) => {
    expect(judge(gapMs)).toEqual(expected);
  });
});
