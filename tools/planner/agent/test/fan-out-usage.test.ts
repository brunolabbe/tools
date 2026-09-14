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
import { DEFAULT_RUN_BUDGET, readMarkers, runFanOut, ScriptedProvider } from "../src/index.ts";
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
};

describe("what a fan-out spent", () => {
  test("counts every reply, a refused specialist's and a re-asked one's included", async () => {
    const refused: ModelUsage = {
      inputTokens: 1,
      cacheReadTokens: 2,
      cacheWriteTokens: 3,
      outputTokens: 4,
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
      fallbackCalls: 0,
    });
  });
});
