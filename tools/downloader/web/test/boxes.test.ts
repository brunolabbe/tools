/**
 * The pure half of dl-133's boxes: which boxes the page shows, and which
 * waiting box starts next. `app.test.tsx` drives the same rules through the
 * page; these pin the counting, where an off-by-one is a third request sent.
 */

import { expect, test } from "vitest";
import {
  JOB_SLOTS,
  PROBE_SLOTS,
  analysesToStart,
  displayBoxes,
  downloadsToStart,
  jobsInFlight,
} from "../src/lib/boxes.ts";
import type { Box } from "../src/lib/boxes.ts";
import { job, probe } from "./fixtures.ts";

function waiting(id: string, order: number): Box {
  return { id, kind: "waiting", url: `https://example.com/${id}`, order, since: 0 };
}

function analysing(id: string): Box {
  return { id, kind: "analysing", url: `https://example.com/${id}`, startedAt: 0, stage: null };
}

function probed(id: string, download: Extract<Box, { kind: "probed" }>["download"]): Box {
  return {
    id,
    kind: "probed",
    url: `https://example.com/${id}`,
    probe: probe(),
    cached: false,
    download,
  };
}

test("the caps are the server's per-client defaults", () => {
  // `api/src/config.ts`: maxProbesPerClient 2, maxJobsPerClient 2.
  expect(PROBE_SLOTS).toBe(2);
  expect(JOB_SLOTS).toBe(2);
});

test("restored jobs follow the page's boxes, and a dismissed job's box is dropped", () => {
  const jobs = [job("downloading", { id: "job-mine" }), job("failed", { id: "job-old" })];
  const mine: Box = { id: "box-1", kind: "job", url: "u", jobId: "job-mine", previewPath: null };
  const gone: Box = { id: "box-2", kind: "job", url: "u", jobId: "job-gone", previewPath: null };
  const shown = displayBoxes([analysing("box-3"), mine, gone], jobs);
  expect(shown.map((box) => box.id)).toEqual(["box-3", "box-1", "job:job-old"]);
});

test("waiting analyses start first come first served, up to the free slots", () => {
  const boxes = [waiting("c", 7), analysing("a"), waiting("b", 3)];
  // One probe in flight: one slot free, and the box that waited longest takes it.
  expect(analysesToStart(boxes).map((box) => box.id)).toEqual(["b"]);
  expect(analysesToStart([...boxes, analysing("d")])).toEqual([]);
});

test("a box whose job is being created holds a job slot, as an unfinished job does", () => {
  const starting = probed("s", { kind: "starting" });
  const queued = probed("q", { kind: "waiting", options: { container: "mp4" }, order: 1 });
  const jobs = [job("downloading", { id: "j1" }), job("completed", { id: "j2" })];
  // The finished job frees its slot; the one being created does not.
  expect(jobsInFlight([starting, queued], jobs)).toBe(2);
  expect(downloadsToStart([starting, queued], jobs)).toEqual([]);
  expect(downloadsToStart([queued], jobs).map((box) => box.id)).toEqual(["q"]);
});

test("an abandoned POST still out takes a probe slot, with no box to show for it (gate 1 F1)", () => {
  const boxes = [waiting("b", 3), analysing("a")];
  expect(analysesToStart(boxes).map((box) => box.id)).toEqual(["b"]);
  expect(analysesToStart(boxes, 1)).toEqual([]);
});
