/**
 * Does the answer fit the question — including the half that needs a calendar.
 *
 * `now` is an argument everywhere here, which is what lets these assertions be
 * about dates rather than about the day the suite happens to run.
 */

import { describe, expect, test } from "vitest";
import { AppError, MAX_TRIP_NIGHTS, type Answer, type QuestionNode } from "@planner/contract";
import { validateAnswer } from "../src/answer.ts";
import { QUESTION_TREE } from "../src/tree.ts";
import { answered, DECLINED, text } from "./helpers.ts";

const NOW = new Date("2026-08-14T12:00:00.000Z");

function nodeById(id: string): QuestionNode {
  const node = QUESTION_TREE.nodes.find((each) => each.id === id);
  if (node === undefined) throw new Error(`no such question: ${id}`);
  return node;
}

/** The code an answer is refused with, or a failure when it is accepted. */
function refusal(node: QuestionNode, answer: Answer, now: Date = NOW): string {
  try {
    validateAnswer(node, answer, now);
  } catch (error) {
    return AppError.from(error).code;
  }
  throw new Error(`${node.id} accepted an answer it should have refused`);
}

function accepts(node: QuestionNode, answer: Answer, now: Date = NOW): void {
  expect(() => validateAnswer(node, answer, now)).not.toThrow();
}

describe("declining", () => {
  test("a core question cannot be declined", () => {
    expect(refusal(nodeById("travellers"), DECLINED)).toBe("INVALID_ANSWER");
  });

  test("a refine question can be", () => {
    accepts(nodeById("access-needs"), DECLINED);
  });
});

describe("the answer's kind", () => {
  test("an answer of the wrong kind is refused", () => {
    expect(refusal(nodeById("travellers"), text("two"))).toBe("INVALID_ANSWER");
  });
});

describe("choices", () => {
  const effort = nodeById("effort");

  test("an option on the list is accepted", () => {
    accepts(effort, answered({ kind: "single-choice", value: "gentle" }));
  });

  test("an option that is not on the list is refused", () => {
    expect(refusal(effort, answered({ kind: "single-choice", value: "heroic" }))).toBe(
      "INVALID_ANSWER",
    );
  });

  test("a multi-choice answer may not repeat, invent or be empty", () => {
    const interests = nodeById("city-and-culture.interests");

    accepts(interests, answered({ kind: "multi-choice", values: ["food", "museums"] }));
    expect(refusal(interests, answered({ kind: "multi-choice", values: ["food", "food"] }))).toBe(
      "INVALID_ANSWER",
    );
    expect(refusal(interests, answered({ kind: "multi-choice", values: ["skiing"] }))).toBe(
      "INVALID_ANSWER",
    );
    expect(refusal(interests, answered({ kind: "multi-choice", values: [] }))).toBe(
      "INVALID_ANSWER",
    );
  });
});

describe("text and lists", () => {
  test("empty text is not an answer — declining is", () => {
    expect(refusal(nodeById("origin"), text("   "))).toBe("INVALID_ANSWER");
  });

  test("text past the question's own limit is refused", () => {
    expect(refusal(nodeById("origin"), text("x".repeat(501)))).toBe("INVALID_ANSWER");
  });

  test("a list is bounded by item count and by each item", () => {
    const cities = nodeById("multi-city.cities");

    accepts(cities, answered({ kind: "text-list", values: ["Trieste", "Ljubljana"] }));
    expect(
      refusal(
        cities,
        answered({ kind: "text-list", values: Array.from({ length: 13 }, () => "x") }),
      ),
    ).toBe("INVALID_ANSWER");
    expect(refusal(cities, answered({ kind: "text-list", values: ["x".repeat(501)] }))).toBe(
      "INVALID_ANSWER",
    );
  });
});

describe("numbers", () => {
  const travellers = nodeById("travellers");

  test("inside the bounds is accepted", () => {
    accepts(travellers, answered({ kind: "number", value: 2 }));
  });

  test("outside them is refused", () => {
    expect(refusal(travellers, answered({ kind: "number", value: 0 }))).toBe("INVALID_ANSWER");
    expect(refusal(travellers, answered({ kind: "number", value: 31 }))).toBe("INVALID_ANSWER");
  });

  test("a fraction of a person is refused; a fraction of an hour is not", () => {
    expect(refusal(travellers, answered({ kind: "number", value: 2.5 }))).toBe("INVALID_ANSWER");
    accepts(nodeById("road-trip.drive-hours"), answered({ kind: "number", value: 4.5 }));
  });

  test("a list of ages is bounded item by item", () => {
    const ages = nodeById("ages");

    accepts(ages, answered({ kind: "number-list", values: [3, 41, 72] }));
    expect(refusal(ages, answered({ kind: "number-list", values: [3, 200] }))).toBe(
      "INVALID_ANSWER",
    );
  });
});

describe("dates", () => {
  const dates = nodeById("dates");

  test("exact dates in the future are accepted", () => {
    accepts(
      dates,
      answered({
        kind: "dates",
        value: { kind: "exact", departure: "2026-09-01", return: "2026-09-08" },
      }),
    );
  });

  test("a departure that has already passed is refused", () => {
    expect(
      refusal(
        dates,
        answered({
          kind: "dates",
          value: { kind: "exact", departure: "2026-08-13", return: "2026-08-20" },
        }),
      ),
    ).toBe("INVALID_DATES");
  });

  test("the clock is an argument, so the same answer ages", () => {
    const answer: Answer = answered({
      kind: "dates",
      value: { kind: "exact", departure: "2026-09-01", return: "2026-09-08" },
    });

    accepts(dates, answer, new Date("2026-08-14T12:00:00.000Z"));
    expect(refusal(dates, answer, new Date("2026-09-02T12:00:00.000Z"))).toBe("INVALID_DATES");
  });

  test("leaving today is not leaving in the past", () => {
    accepts(
      dates,
      answered({
        kind: "dates",
        value: { kind: "exact", departure: "2026-08-14", return: "2026-08-18" },
      }),
    );
  });

  test("a trip longer than this tool plans is refused", () => {
    expect(
      refusal(
        dates,
        answered({
          kind: "dates",
          value: { kind: "exact", departure: "2026-09-01", return: "2026-12-01" },
        }),
      ),
    ).toBe("INVALID_DATES");
    expect(MAX_TRIP_NIGHTS).toBeLessThan(91);
  });

  test("a window is accepted, and a window too narrow to hold the nights is not", () => {
    accepts(
      dates,
      answered({
        kind: "dates",
        value: { kind: "window", earliest: "2027-02-01", latest: "2027-02-28", nights: 3 },
      }),
    );

    // "Two weeks between the 1st and the 7th" — the same contradiction as every
    // other date failure, which is why it is the same code.
    expect(
      refusal(
        dates,
        answered({
          kind: "dates",
          value: { kind: "window", earliest: "2027-02-01", latest: "2027-02-07", nights: 14 },
        }),
      ),
    ).toBe("INVALID_DATES");
  });

  test("a duration with no dates at all is a real answer", () => {
    accepts(dates, answered({ kind: "dates", value: { kind: "open", nights: 10 } }));
  });
});

describe("budget", () => {
  const budget = nodeById("budget");

  test("a figure and a feeling are both answers", () => {
    accepts(
      budget,
      answered({
        kind: "budget",
        value: { kind: "amount", currency: "CAD", amount: 4_000, basis: "total" },
      }),
    );
    accepts(budget, answered({ kind: "budget", value: { kind: "band", band: "shoestring" } }));
  });
});
