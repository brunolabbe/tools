/**
 * dl-54: a job row, and the page URL in it, is deleted at `JOB_RETENTION_DAYS`.
 *
 * The terms page promises it. A job row is the one place the full URL a visitor
 * submitted is stored — query string included — so these run the real sweep
 * against a clock the test controls, not the store's SQL alone.
 */

import { describe, expect, test } from "vitest";
import { JOB_RETENTION_DAYS } from "../src/jobs/links.ts";
import { runSweep } from "../src/server.ts";
import { createHarness } from "./helpers.ts";

const DAY_MS = 24 * 3_600_000;
const NOW = new Date("2026-10-03T00:00:00.000Z");
const SIGNED = "https://site.example/watch/42?token=SECRET";

function isoAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

describe("job retention", () => {
  test("is the fourteen days the terms page states", () => {
    expect(JOB_RETENTION_DAYS).toBe(14);
  });

  test("the sweep deletes a job older than the limit and leaves a younger one alone", async () => {
    const harness = await createHarness({ now: () => NOW });
    try {
      const { store } = harness.app.context;
      const link = (token: string): { token: string; url: string; expiresAt: string } => ({
        token,
        url: `/api/files/${token}`,
        expiresAt: isoAgo(0),
      });
      store.create({
        id: "old",
        sourceUrl: SIGNED,
        options: {},
        variantId: null,
        createdAt: isoAgo(JOB_RETENTION_DAYS + 1),
        link: link("tok-old"),
      });
      store.create({
        id: "young",
        sourceUrl: SIGNED,
        options: {},
        variantId: null,
        createdAt: isoAgo(JOB_RETENTION_DAYS - 1),
        link: link("tok-young"),
      });

      runSweep(harness.app.context);

      expect(store.find("old")).toBeNull();
      expect(store.find("young")?.sourceUrl).toBe(SIGNED);
      // Its link row went with it (cascade), so no URL survives in a side table.
      expect(store.findLink("tok-old")).toBeNull();
      expect(store.findLink("tok-young")).not.toBeNull();
    } finally {
      await harness.dispose();
    }
  });

  test("deletes the row, so the URL kept in a failed job's error goes too", async () => {
    const harness = await createHarness({ now: () => NOW });
    try {
      const { store } = harness.app.context;
      store.create({
        id: "failed",
        sourceUrl: SIGNED,
        options: {},
        variantId: null,
        createdAt: isoAgo(JOB_RETENTION_DAYS + 1),
        link: { token: "tok-failed", url: "/api/files/tok-failed", expiresAt: isoAgo(0) },
      });
      store.transition(
        "failed",
        "failed",
        {
          error: {
            code: "UNREACHABLE",
            message: "The site could not be reached.",
            retryable: true,
            details: { url: SIGNED },
          },
        },
        isoAgo(JOB_RETENTION_DAYS + 1),
      );
      // The premise of deleting rather than clearing `source_url`: the same URL
      // sits in a second column.
      expect(store.get("failed").error?.details).toEqual({ url: SIGNED });

      runSweep(harness.app.context);

      expect(store.find("failed")).toBeNull();
    } finally {
      await harness.dispose();
    }
  });

  test("a job exactly at the limit is kept; the sweep takes only what is older", async () => {
    const harness = await createHarness({ now: () => NOW });
    try {
      const { store } = harness.app.context;
      store.create({
        id: "edge",
        sourceUrl: SIGNED,
        options: {},
        variantId: null,
        createdAt: isoAgo(JOB_RETENTION_DAYS),
        link: { token: "tok-edge", url: "/api/files/tok-edge", expiresAt: isoAgo(0) },
      });

      runSweep(harness.app.context);

      expect(store.find("edge")).not.toBeNull();
    } finally {
      await harness.dispose();
    }
  });
});
