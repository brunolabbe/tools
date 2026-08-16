/**
 * A model reply is untrusted input, and this is where that is enforced.
 *
 * The re-ask is bounded and it lives inside the agent — `AGENT_MALFORMED_REPLY`
 * is deliberately absent from `RETRYABLE_CODES` because replaying the whole run
 * from the top is the wrong retry. Past the budget it raises, and the
 * orchestrator turns the raise into a gap rather than into a failed run.
 */

import { describe, expect, test } from "vitest";
import { AppError, MODEL_ASSERTED } from "@planner/contract";
import { loadFixture } from "../../contract/test/fixtures.ts";
import { askSpecialist, DEFAULT_RUN_BUDGET, extractJson } from "../src/index.ts";
import { candidates, capacityOf, content, FakeProvider } from "./helpers.ts";

const brief = loadFixture("road-trip").brief;
const capacity = capacityOf(brief);

const HOTEL = {
  title: "A motel with showers",
  summary: "Simple rooms and a kitchenette.",
  location: {
    kind: "at",
    place: { name: "Rimouski", locality: "Québec, Canada", coordinates: null },
  },
  durationMinutes: null,
  cost: null,
  season: null,
  bookingLeadTimeDays: 30,
  provenance: MODEL_ASSERTED,
};

function ask(provider: FakeProvider, budget = DEFAULT_RUN_BUDGET) {
  return askSpecialist({
    provider,
    specialist: "lodging",
    shape: "road-trip",
    brief,
    capacity,
    budget,
  });
}

describe("reading a reply", () => {
  test("takes the candidates out of clean JSON", async () => {
    const result = await ask(new FakeProvider({ lodging: [candidates(HOTEL)] }));
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.title).toBe("A motel with showers");
  });

  test("unwraps a fenced block, because a model that explains itself is still useful", () => {
    expect(extractJson('```json\n{"candidates":[]}\n```')).toBe('{"candidates":[]}');
    expect(extractJson('Sure!\n{"candidates":[]}\nHope that helps.')).toBe('{"candidates":[]}');
    expect(extractJson('```json  \n{"candidates":[]}\n```')).toBe('{"candidates":[]}');
  });

  test("an unterminated fence does not make the unwrapping regex chew", () => {
    // A reply is untrusted input, so the fence pattern must not be one a
    // stranger can turn into a stalled event loop. `\s*\n` was: two ways to
    // consume each line, no closing fence to stop on.
    const hostile = "```\n" + "\n ".repeat(60_000);
    const started = performance.now();

    expect(extractJson(hostile)).toBe(hostile.trim());
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("an empty list is a real answer and not a failure", async () => {
    const result = await ask(new FakeProvider({ lodging: [candidates()] }));
    expect(result.proposals).toEqual([]);
  });

  test("a field that does not fit the contract is refused, not coerced", async () => {
    const bad = { ...HOTEL, bookingLeadTimeDays: -5 };
    const provider = new FakeProvider({ lodging: [candidates(bad), candidates(HOTEL)] });

    const result = await ask(provider);
    // Refused once, re-asked, and the second answer stood.
    expect(provider.asked).toHaveLength(2);
    expect(result.proposals).toHaveLength(1);
  });

  test("an id or a specialist in the reply is not the model's to give", async () => {
    // Both are stamped on by the orchestrator. A reply carrying them is not an
    // error — the schema simply does not read them — and what matters is that
    // nothing downstream can be told a lie about who proposed something.
    const result = await ask(
      new FakeProvider({
        lodging: [candidates({ ...HOTEL, id: "theirs", specialist: "activities" })],
      }),
    );
    expect(result.proposals[0]).not.toHaveProperty("id");
    expect(result.proposals[0]).not.toHaveProperty("specialist");
  });
});

describe("when a reply cannot be used", () => {
  test("re-asks once, with the failure fed back", async () => {
    const provider = new FakeProvider({
      lodging: [content("I am afraid I cannot do that."), candidates(HOTEL)],
    });
    const result = await ask(provider);

    expect(provider.asked).toHaveLength(2);
    expect(result.replies).toHaveLength(2);
    expect(result.proposals).toHaveLength(1);
  });

  test("gives up as AGENT_MALFORMED_REPLY once the attempts are spent", async () => {
    const provider = new FakeProvider({ lodging: [content("still not JSON")] });

    await expect(ask(provider)).rejects.toMatchObject({ code: "AGENT_MALFORMED_REPLY" });
    expect(provider.asked).toHaveLength(DEFAULT_RUN_BUDGET.maxAttemptsPerSpecialist);
  });

  test("one attempt means one attempt", async () => {
    const provider = new FakeProvider({ lodging: [content("nope")] });
    await expect(
      ask(provider, { ...DEFAULT_RUN_BUDGET, maxAttemptsPerSpecialist: 1 }),
    ).rejects.toThrow(AppError);
    expect(provider.asked).toHaveLength(1);
  });

  test("a refusal is terminal — asking the same question louder is not a retry", async () => {
    const provider = new FakeProvider({
      lodging: [
        {
          kind: "reply",
          reply: {
            content: "",
            stopReason: "refusal",
            usage: { inputTokens: null, outputTokens: null },
          },
        },
      ],
    });

    await expect(ask(provider)).rejects.toMatchObject({ code: "AGENT_REFUSED" });
    expect(provider.asked).toHaveLength(1);
  });

  test("a reply cut off at the token ceiling is re-asked with that said", async () => {
    const provider = new FakeProvider({
      lodging: [
        {
          kind: "reply",
          reply: {
            content: '{"candidates":[{"title":"A motel wi',
            stopReason: "length",
            usage: { inputTokens: null, outputTokens: null },
          },
        },
        candidates(HOTEL),
      ],
    });

    const result = await ask(provider);
    expect(result.proposals).toHaveLength(1);
  });
});

describe("cancellation", () => {
  test("an aborted signal stops before anything is sent", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new FakeProvider({ lodging: [candidates(HOTEL)] });

    await expect(
      askSpecialist({
        provider,
        specialist: "lodging",
        shape: "road-trip",
        brief,
        capacity,
        budget: DEFAULT_RUN_BUDGET,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(provider.asked).toEqual([]);
  });
});
