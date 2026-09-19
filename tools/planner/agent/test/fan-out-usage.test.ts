/**
 * What a fan-out spent, counted at the seam (pl-49).
 *
 * Before pl-49 the total came from the replies each *successful* specialist
 * returned, so a refused specialist's reply — billed — fell out of it, and a
 * cancellation rethrew before anything was added up at all. These tests are
 * about the replies that land and are then thrown away.
 */

import { describe, expect, test } from "vitest";
import { AppError } from "@planner/contract";
import { loadFixture } from "../../contract/test/fixtures.ts";
import {
  addReplyUsage,
  DEFAULT_RUN_BUDGET,
  emptyRunUsage,
  readMarkers,
  runFanOut,
  ScriptedProvider,
} from "../src/index.ts";
import type { ModelProvider, ModelUsage, RunUsage } from "../src/index.ts";
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

/** Every `content` turn in `FakeProvider` bills this. */
const ORDINARY: ModelUsage = {
  inputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 200,
  thinkingTokens: 20,
};

describe("what a fan-out spent", () => {
  test("counts every reply, a refused specialist's and a re-asked one's included", async () => {
    const refused: ModelUsage = {
      inputTokens: 1,
      cacheReadTokens: 2,
      cacheWriteTokens: 3,
      outputTokens: 4,
      thinkingTokens: 1,
    };
    const provider = new FakeProvider({
      lodging: [{ kind: "reply", reply: { content: "", stopReason: "refusal", usage: refused } }],
      // Malformed once, then fine: two replies, both billed.
      activities: [content("not json"), candidates()],
    });

    const result = await run(provider);

    // Lodging refused and is a gap — and its reply still cost something.
    expect(result.gaps.find((gap) => gap.specialist === "lodging")?.reason).toBe(
      "specialist-failed",
    );
    expect(provider.asked.filter((entry) => entry === "activities")).toHaveLength(2);

    const ordinary = provider.asked.length - 1;
    expect(result.usage).toEqual({
      calls: provider.asked.length,
      inputTokens: ordinary * 100 + 1,
      cacheReadTokens: 2,
      cacheWriteTokens: 3,
      outputTokens: ordinary * 200 + 4,
      thinkingTokens: ordinary * 20 + 1,
      fallbackCalls: 0,
    });
  });

  test("hands onUsage the running total after every reply, ending at the result's", async () => {
    const seen: RunUsage[] = [];
    const provider = new FakeProvider({});

    const result = await run(provider, { onUsage: (usage) => seen.push(usage) });

    expect(provider.asked.length).toBeGreaterThan(1);
    expect(seen.map((usage) => usage.calls)).toEqual(provider.asked.map((_, index) => index + 1));
    expect(seen.at(-1)).toEqual(result.usage);
  });

  test("a canceled fan-out has already handed over the replies that landed before it", async () => {
    // The api cannot read a result off a run that threw, so what it records for
    // a canceled run is the last total `onUsage` gave it. Lodging's reply lands;
    // activities then aborts the run.
    const controller = new AbortController();
    const seen: RunUsage[] = [];
    const inner = new FakeProvider({});
    let landed = 0;
    // Activities waits a macrotask before aborting, so every other specialist's
    // reply has landed first and the count is not a microtask race.
    const provider: ModelProvider = {
      name: inner.name,
      model: inner.model,
      send: async (request) => {
        if (readMarkers(request.system)?.specialist === "activities") {
          await new Promise((resolve) => setTimeout(resolve, 10));
          controller.abort();
          throw new AppError("CANCELED");
        }
        const reply = await inner.send(request);
        landed += 1;
        return reply;
      },
    };

    await expect(
      runFanOut({
        brief,
        capacity,
        provider,
        budget: DEFAULT_RUN_BUDGET,
        runId: "run-1",
        signal: controller.signal,
        onUsage: (usage) => seen.push(usage),
      }),
    ).rejects.toThrow();

    expect(landed).toBeGreaterThan(0);
    expect(inner.asked).not.toContain("activities");
    expect(seen.at(-1)).toEqual({
      calls: landed,
      inputTokens: landed * (ORDINARY.inputTokens ?? 0),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: landed * (ORDINARY.outputTokens ?? 0),
      thinkingTokens: landed * (ORDINARY.thinkingTokens ?? 0),
      fallbackCalls: 0,
    });
  });

  test("counts a reply another model served apart, and not one that names the configured model", async () => {
    const reply = (servedModel: string) => ({
      kind: "reply" as const,
      reply: {
        content: JSON.stringify({ candidates: [] }),
        stopReason: "end" as const,
        usage: ORDINARY,
        servedModel,
      },
    });
    const provider = new FakeProvider({
      lodging: [reply("another-model")],
      // `FakeProvider.model` is "fake": this one is the configured model.
      activities: [reply("fake")],
    });

    const result = await run(provider);

    expect(result.usage.fallbackCalls).toBe(1);
    expect(result.usage.calls).toBe(provider.asked.length);
  });

  test("a provider that reports no counts leaves every kind null, and still counts the calls", async () => {
    const result = await run(new ScriptedProvider());

    expect(result.usage.calls).toBeGreaterThan(0);
    expect(result.usage).toMatchObject({
      inputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      outputTokens: null,
      thinkingTokens: null,
      fallbackCalls: 0,
    });
  });
});

// A minimal `ModelUsage`/`ModelReply` for the mixed-run describe below —
// module scope, not a closure, since neither captures anything from a test.
function mixedRunUsage(thinkingTokens: number | null, outputTokens: number): ModelUsage {
  return {
    inputTokens: 1,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    outputTokens,
    thinkingTokens,
  };
}
function mixedRunReply(thinkingTokens: number | null, outputTokens: number) {
  return {
    content: "",
    stopReason: "end" as const,
    usage: mixedRunUsage(thinkingTokens, outputTokens),
  };
}

describe("thinkingTokens across a mixed run (pl-50, med 3, owner's decision A, 2026-09-19)", () => {
  // Decided by the owner over nulling the sum once coverage is incomplete, or
  // carrying a separate coverage count: `addReplyUsage` keeps summing past a
  // `null`, so this total is a lower bound over the replies that reported a
  // breakdown, never a guaranteed total for the run — see `RunUsage`'s own
  // doc comment. Exercised directly against `addReplyUsage`/`emptyRunUsage`,
  // the same functions the gate's own repro called, rather than through a
  // full fan-out — a real fan-out bills every unscripted specialist too,
  // which would make "exactly 1390" depend on the roster instead of on this
  // decision.
  const reply = mixedRunReply;

  test("a reply with no breakdown followed by one that reported 1390 sums to 1390, not null", () => {
    let total = emptyRunUsage();
    total = addReplyUsage(total, reply(null, 210), "m");
    total = addReplyUsage(total, reply(1_390, 1_400), "m");

    expect(total.thinkingTokens).toBe(1_390);
    expect(total.outputTokens).toBe(1_610);
  });

  test("the same two replies in the opposite order sum the same way", () => {
    let total = emptyRunUsage();
    total = addReplyUsage(total, reply(1_390, 1_400), "m");
    total = addReplyUsage(total, reply(null, 210), "m");

    expect(total.thinkingTokens).toBe(1_390);
  });

  test("indistinguishable from a run whose only reply thought 1390 — the coverage gap this is a lower bound for", () => {
    let mixed = emptyRunUsage();
    mixed = addReplyUsage(mixed, reply(null, 210), "m");
    mixed = addReplyUsage(mixed, reply(1_390, 1_400), "m");

    let singleReply = emptyRunUsage();
    singleReply = addReplyUsage(singleReply, reply(1_390, 1_400), "m");

    expect(mixed.thinkingTokens).toBe(singleReply.thinkingTokens);
  });

  test("two replies that both report no breakdown stay null", () => {
    let total = emptyRunUsage();
    total = addReplyUsage(total, reply(null, 210), "m");
    total = addReplyUsage(total, reply(null, 1_400), "m");

    expect(total.thinkingTokens).toBeNull();
  });
});
