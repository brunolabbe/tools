/**
 * `restoreRevision` — a copy of revision _n_ as a new revision (pl-43 step 5).
 */

import { expect, test } from "vitest";
import { planRevisionSchema } from "@planner/contract";
import { restoreRevision } from "../src/restore.ts";
import { travelled } from "./helpers.ts";
import { appended, idsIn, revisionOf, withoutIds } from "./revisions.ts";

const RESTORE = {
  id: "rev-3",
  reason: "Restored revision 1.",
  createdAt: "2027-01-03T00:00:00.000Z",
};

const target = revisionOf({
  id: "rev-1",
  days: [
    [
      { candidate: "lodge", pinned: true, note: "Booked by the user." },
      { candidate: "hike", travel: travelled({ durationMinutes: 20 }), startsAt: "09:30" },
    ],
    ["museum"],
  ],
  gaps: [{ specialist: "food", reason: "specialist-failed", detail: "The food search failed." }],
  coverage: [
    { kind: "coverage", detail: "There is very little on the map here.", candidateIds: [] },
  ],
  reading: [
    {
      url: "https://fixtures.invalid/planner/reading",
      title: "Checked-in fixture",
      fetchedAt: "2026-08-22T00:00:00.000Z",
    },
  ],
});

test("copies days, pins, notes, start times and travelFromPrevious as stored", () => {
  const restored = restoreRevision(target, RESTORE);
  expect(withoutIds(restored.days)).toEqual(withoutIds(target.days));
  expect(restored.days[0]?.items[0]?.pinned).toBe(true);
  expect(restored.days[0]?.items[1]?.travelFromPrevious).toEqual(
    travelled({ durationMinutes: 20 }),
  );
});

test("re-keys every id, so none collides with the target's", () => {
  const restored = restoreRevision(target, RESTORE);
  const theirs = new Set(idsIn(target.days));
  expect(idsIn(restored.days)).toHaveLength(theirs.size);
  expect(idsIn(restored.days).filter((id) => theirs.has(id))).toEqual([]);
  expect(idsIn(restored.days).every((id) => id.startsWith("rev-3-"))).toBe(true);
});

test("stamps the restore operation, and copies gaps, coverage and reading", () => {
  const restored = restoreRevision(target, RESTORE);
  expect(restored.operation).toEqual({ kind: "restore", revision: 1 });
  expect(restored.gaps).toEqual(target.gaps);
  expect(restored.coverage).toEqual(target.coverage);
  expect(restored.reading).toEqual(target.reading);
  expect(restored.reason).toBe(RESTORE.reason);

  const latest = revisionOf({ id: "rev-2", parentRevisionId: "rev-1", days: [[], []] });
  expect(() => planRevisionSchema.parse(appended(latest, restored))).not.toThrow();
});
