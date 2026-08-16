/**
 * The run itself: who ran, what came back, what was refused, and what the plan
 * is told about everyone who did not contribute.
 *
 * The assertion that matters most here is the one about failure. §7 and the
 * repo's _never fake progress_ rule: **one specialist failing must not fail the
 * run**, and the plan must say lodging was not checked rather than quietly
 * lacking a lodging section.
 */

import { describe, expect, test, vi } from "vitest";
import { AppError, MODEL_ASSERTED, slot } from "@planner/contract";
import type { TripBrief } from "@planner/contract";
import { loadFixture } from "../../contract/test/fixtures.ts";
import {
  DEFAULT_RUN_BUDGET,
  runFanOut,
  ScriptedProvider,
  type FanOutProgress,
} from "../src/index.ts";
import { candidates, capacityOf, content, FakeProvider } from "./helpers.ts";

const brief = loadFixture("road-trip").brief;
const capacity = capacityOf(brief);

function run(
  provider: FakeProvider | ScriptedProvider,
  overrides: Partial<Parameters<typeof runFanOut>[0]> = {},
) {
  return runFanOut({
    brief,
    capacity,
    provider,
    budget: DEFAULT_RUN_BUDGET,
    runId: "run-1",
    ...overrides,
  });
}

const LEG = {
  title: "Québec City to Rimouski",
  summary: "Four hours along the estuary.",
  location: {
    kind: "between",
    from: { name: "Québec City", locality: "Québec, Canada", coordinates: null },
    to: { name: "Rimouski", locality: "Québec, Canada", coordinates: null },
  },
  durationMinutes: 240,
  cost: null,
  season: null,
  bookingLeadTimeDays: null,
  provenance: MODEL_ASSERTED,
};

describe("a run against the scripted provider", () => {
  test("produces candidates from every rostered specialist", async () => {
    const result = await run(new ScriptedProvider());

    const proposed = new Set(result.candidates.map((candidate) => candidate.specialist));
    for (const entry of result.roster.ran) expect(proposed).toContain(entry.specialist);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  test("stamps the specialist and a derived id on every candidate", async () => {
    const result = await run(new ScriptedProvider());

    const ids = result.candidates.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const candidate of result.candidates) {
      expect(candidate.id.startsWith(`run-1-${candidate.specialist}-`)).toBe(true);
    }
  });

  test("is deterministic — the same run twice is the same candidate set", async () => {
    const first = await run(new ScriptedProvider());
    const second = await run(new ScriptedProvider());
    expect(second.candidates).toEqual(first.candidates);
  });

  test("nothing it returns says which day anything falls on", async () => {
    const result = await run(new ScriptedProvider());
    for (const candidate of result.candidates) {
      expect(Object.keys(candidate)).not.toContain("dayIndex");
      expect(Object.keys(candidate)).not.toContain("startsAt");
    }
  });
});

describe("progress", () => {
  test("reports the roster before the fan-out, and then one event per specialist", async () => {
    const events: FanOutProgress[] = [];
    const result = await run(new ScriptedProvider(), { onProgress: (event) => events.push(event) });

    const first = events[0];
    expect(first?.type).toBe("roster");
    // The total is known before a single request goes out, which is what lets a
    // UI say "4 of 5" rather than show a spinner.
    if (first?.type !== "roster") throw new Error("the roster event went missing");
    expect(first.total).toBe(result.roster.ran.length);

    const finished = events.filter((event) => event.type === "specialist-finished");
    expect(finished).toHaveLength(result.roster.ran.length);
    expect(
      finished.map((event) => (event.type === "specialist-finished" ? event.done : 0)),
    ).toEqual(finished.map((_, index) => index + 1));
  });
});

describe("when one specialist fails", () => {
  test("the run ships and the plan says that part was not checked", async () => {
    const provider = new FakeProvider(
      { lodging: [{ kind: "throw", error: new AppError("AGENT_UNAVAILABLE") }] },
      candidates(),
    );
    const events: FanOutProgress[] = [];
    const result = await run(provider, { onProgress: (event) => events.push(event) });

    const gap = result.gaps.find((entry) => entry.specialist === "lodging");
    expect(gap?.reason).toBe("specialist-failed");
    expect(gap?.detail).toContain("not answering");

    expect(events).toContainEqual(
      expect.objectContaining({ type: "specialist-failed", specialist: "lodging" }),
    );
  });

  test("nothing is invented in its place", async () => {
    const provider = new FakeProvider(
      { lodging: [{ kind: "throw", error: new AppError("TIMEOUT") }] },
      candidates(),
    );
    const result = await run(provider);
    expect(result.candidates.filter((candidate) => candidate.specialist === "lodging")).toEqual([]);
  });

  test("a specialist whose replies never parse becomes a gap, not a failed run", async () => {
    const provider = new FakeProvider({ activities: [content("prose, every time")] }, candidates());
    const result = await run(provider);

    const gap = result.gaps.find((entry) => entry.specialist === "activities");
    expect(gap?.reason).toBe("specialist-failed");
  });
});

describe("what the fan-out refuses to keep", () => {
  test("a leg longer than the day allows — pl-9's finding, enforced", async () => {
    // 330 minutes to a party who answered `half-day`, which is 300. This is the
    // exact candidate the road-trip fixture carries and the composer throws
    // away; refusing it here is what makes the gap say something true.
    const provider = new FakeProvider(
      { "route-and-logistics": [candidates({ ...LEG, durationMinutes: 330 }, LEG)] },
      candidates(),
    );
    const result = await run(provider);

    expect(result.rejected).toContainEqual({
      specialist: "route-and-logistics",
      title: LEG.title,
      reason: "over-day-capacity",
    });
    expect(result.candidates.filter((c) => c.specialist === "route-and-logistics")).toHaveLength(1);
  });

  test("a leg whose endpoints went back into its title", async () => {
    const flattened = {
      ...LEG,
      title: "Québec City to Rimouski via the 132",
      location: {
        kind: "at",
        place: { name: "Route 132", locality: "Québec, Canada", coordinates: null },
      },
    };
    const provider = new FakeProvider(
      { "route-and-logistics": [candidates(flattened)] },
      candidates(),
    );
    const result = await run(provider);

    expect(result.rejected).toContainEqual({
      specialist: "route-and-logistics",
      title: flattened.title,
      reason: "wrong-location-kind",
    });
  });

  test("a duration nobody established is kept, because unknown is not too long", async () => {
    const provider = new FakeProvider(
      { "route-and-logistics": [candidates({ ...LEG, durationMinutes: null })] },
      candidates(),
    );
    const result = await run(provider);

    expect(result.candidates.filter((c) => c.specialist === "route-and-logistics")).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  test("a specialist that returned nothing usable says so as a gap", async () => {
    const provider = new FakeProvider(
      { "route-and-logistics": [candidates({ ...LEG, durationMinutes: 900 })] },
      candidates(),
    );
    const result = await run(provider);

    const gap = result.gaps.find((entry) => entry.specialist === "route-and-logistics");
    expect(gap?.reason).toBe("no-candidates-found");
    expect(gap?.detail).toMatch(/fitted the days/);
  });
});

describe("the budget, and the gaps it leaves", () => {
  test("a roster over the cap is degraded before anything is sent", async () => {
    const provider = new FakeProvider({}, candidates());
    const result = await run(provider, {
      budget: { ...DEFAULT_RUN_BUDGET, maxSpecialists: 2 },
    });

    expect(provider.asked).toHaveLength(2);
    expect(result.roster.droppedForBudget.map((entry) => entry.specialist)).toEqual([
      "activities",
      "food",
      "budget",
    ]);
    expect(
      result.gaps.filter((gap) => gap.reason === "specialist-dropped-for-budget"),
    ).toHaveLength(3);
  });

  test("a specialist that was never on the roster is reassurance, not a warning", async () => {
    const result = await run(new ScriptedProvider());
    const gap = result.gaps.find((entry) => entry.specialist === "practicalities");
    expect(gap?.reason).toBe("specialist-not-applicable");
  });
});

describe("cancellation", () => {
  test("kills the whole fan-out rather than leaving gaps behind", async () => {
    const controller = new AbortController();
    const provider = new FakeProvider(
      {
        "route-and-logistics": [
          {
            kind: "throw",
            error: (() => {
              controller.abort();
              return new AppError("CANCELED");
            })(),
          },
        ],
      },
      candidates(),
    );

    await expect(run(provider, { signal: controller.signal })).rejects.toThrow();
  });

  test("an already-aborted run sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new FakeProvider({}, candidates());

    await expect(run(provider, { signal: controller.signal })).rejects.toThrow();
    expect(provider.asked).toEqual([]);
  });
});

describe("a brief too thin to plan from", () => {
  test("is refused before a single specialist is paid for", async () => {
    const thin: TripBrief = { ...brief, effort: slot.unknown() };
    const provider = new FakeProvider({}, candidates());
    const send = vi.spyOn(provider, "send");

    await expect(
      runFanOut({
        brief: thin,
        capacity,
        provider,
        budget: DEFAULT_RUN_BUDGET,
        runId: "run-1",
      }),
    ).rejects.toMatchObject({ code: "BRIEF_INCOMPLETE" });
    expect(send).not.toHaveBeenCalled();
  });
});
