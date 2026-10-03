/**
 * dl-54: a preview image is gone from memory when it expires, not when something
 * happens to ask for it.
 *
 * `ThumbnailStore` evicts lazily, so without the sweep an entry on a quiet
 * instance outlives its ten minutes until 400 newer ones or a restart replace
 * it. The terms page says ten minutes. These run the real sweep against a clock
 * the test moves, and read `size`, which a `get` cannot: a `get` would evict the
 * entry itself and hide the failure.
 */

import { describe, expect, test } from "vitest";
import { runSweep } from "../src/server.ts";
import { createHarness } from "./helpers.ts";

const MINUTE_MS = 60_000;
const IMAGE = { contentType: "image/jpeg", bytes: Buffer.from("jpeg") };

describe("the sweep and the preview store", () => {
  test("a preview past its ten minutes is dropped by the sweep without anyone asking for it", async () => {
    let clock = new Date("2026-10-03T00:00:00.000Z");
    const harness = await createHarness({ now: () => clock });
    try {
      const { thumbnails } = harness.app.context;
      thumbnails.put(IMAGE);
      expect(thumbnails.size).toBe(1);

      clock = new Date(clock.getTime() + 11 * MINUTE_MS);
      runSweep(harness.app.context);

      expect(thumbnails.size).toBe(0);
    } finally {
      await harness.dispose();
    }
  });

  test("a younger preview is left, and the expiry is `get`'s own: exactly ten minutes is gone", async () => {
    let clock = new Date("2026-10-03T00:00:00.000Z");
    const harness = await createHarness({ now: () => clock });
    try {
      const { thumbnails } = harness.app.context;
      const old = thumbnails.put(IMAGE);
      clock = new Date(clock.getTime() + 5 * MINUTE_MS);
      const young = thumbnails.put(IMAGE);

      // At 10:00 the first is exactly at its limit, which `get` treats as expired.
      clock = new Date(clock.getTime() + 5 * MINUTE_MS);
      runSweep(harness.app.context);

      expect(thumbnails.size).toBe(1);
      expect(thumbnails.get(old)).toBeNull();
      expect(thumbnails.get(young)).not.toBeNull();
    } finally {
      await harness.dispose();
    }
  });
});
