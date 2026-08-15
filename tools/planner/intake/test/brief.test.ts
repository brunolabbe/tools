/**
 * Answers becoming the document specialists read.
 *
 * Everything here goes through the checked-in tree, because the interesting
 * claims are about the pair: a tree that assembles a brief the contract refuses
 * is a tree bug, and this is where it would show.
 */

import { describe, expect, test } from "vitest";
import { AppError, isAnswered, type Answers } from "@planner/contract";
import { toBrief } from "../src/brief.ts";
import { QUESTION_TREE } from "../src/tree.ts";
import { answered, choice, DECLINED, text, walk } from "./helpers.ts";

describe("toBrief", () => {
  test("an answer lands in the slot its question fills", () => {
    const answers: Answers = {
      shape: choice("city-and-culture"),
      origin: text("Montréal"),
      travellers: answered({ kind: "number", value: 2 }),
      dates: answered({ kind: "dates", value: { kind: "open", nights: 6 } }),
      "city-and-culture.interests": answered({
        kind: "multi-choice",
        values: ["food", "history"],
      }),
    };

    const brief = toBrief(QUESTION_TREE, answers);

    expect(brief.origin).toEqual({ state: "answered", value: "Montréal" });
    expect(brief.travellers).toEqual({ state: "answered", value: 2 });
    expect(brief.details?.shape).toBe("city-and-culture");
    expect(brief.details).toMatchObject({
      interests: { state: "answered", value: ["food", "history"] },
    });
  });

  test("an unanswered question is unknown, and a declined one is declined", () => {
    const answers: Answers = { shape: choice("resort"), "access-needs": DECLINED };
    const brief = toBrief(QUESTION_TREE, answers);

    // The distinction the whole three-state slot exists for: one of these is a
    // question to put next, the other is settled forever.
    expect(brief.accessNeeds).toEqual({ state: "declined" });
    expect(brief.destination).toEqual({ state: "unknown" });
    expect(isAnswered(brief.accessNeeds)).toBe(false);
  });

  test("an answer stranded on an abandoned branch is not in the brief", () => {
    // The store may still hold it — the write and the prune are one transaction
    // in pl-7 — but it is not part of the trip being described.
    const backcountry = walk(QUESTION_TREE, { preset: { shape: choice("backcountry") } });
    const switched: Answers = { ...backcountry, shape: choice("resort") };

    const brief = toBrief(QUESTION_TREE, switched);

    expect(brief.details?.shape).toBe("resort");
    expect(JSON.stringify(brief)).not.toContain("nightsOut");
  });

  test("changing the shape keeps the core answers", () => {
    const before = walk(QUESTION_TREE, { preset: { shape: choice("backcountry") } });
    const after = toBrief(QUESTION_TREE, { ...before, shape: choice("multi-city") });

    expect(after.origin).toEqual({ state: "answered", value: "something" });
    expect(isAnswered(after.dates)).toBe(true);
    expect(isAnswered(after.travellers)).toBe(true);
  });

  test("an answer that does not fit its slot fails loudly", () => {
    // `validateAnswer` refuses this at the boundary; the schema parse at the
    // end of assembly is the backstop, and a wrong slot must never reach a
    // specialist as a brief that merely looks odd.
    const answers: Answers = {
      shape: choice("resort"),
      travellers: answered({ kind: "number", value: 900 }),
    };

    let code: string | null = null;
    try {
      toBrief(QUESTION_TREE, answers);
    } catch (error) {
      code = AppError.from(error).code;
    }

    expect(code).toBe("INTERNAL");
  });

  test("a brief with nothing answered is empty rather than wrong", () => {
    const brief = toBrief(QUESTION_TREE, {});

    expect(brief.details).toBeNull();
    expect(brief.shape).toEqual({ state: "unknown" });
  });
});
