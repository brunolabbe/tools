/**
 * The checked-in tree, held to what the wizard promises about it.
 *
 * The load-bearing one is `core` ⇄ `missingRequiredSlots`, in both directions:
 * the wizard stops when nothing reachable and `core` is unanswered and says the
 * essentials are done. If those two sets can disagree, that sentence is a lie.
 */

import { describe, expect, test } from "vitest";
import {
  missingRequiredSlots,
  REQUIRED_CORE_SLOTS,
  REQUIRED_SHAPE_SLOTS,
  TRIP_SHAPES,
  tripBriefSchema,
  type TripShape,
} from "@planner/contract";
import { nextQuestion, reachable } from "../src/engine.ts";
import { toBrief } from "../src/brief.ts";
import { QUESTION_TREE } from "../src/tree.ts";
import { validateAnswer } from "../src/answer.ts";
import { validateTree } from "../src/validate.ts";
import { answerFor, choice, DECLINED, DIVERGING_SHAPES, walk } from "./helpers.ts";

const NOW = new Date("2026-08-14T12:00:00.000Z");

test("the checked-in tree is valid", () => {
  expect(validateTree(QUESTION_TREE)).toEqual([]);
});

test("every question comes with an answer the question itself accepts", () => {
  // The bounds a node carries are the wizard's input attributes; this is what
  // stops one drifting looser than the slot it fills.
  for (const node of QUESTION_TREE.nodes) {
    expect(() => validateAnswer(node, answerFor(node), NOW), node.id).not.toThrow();
  }
});

describe("the checkpoint", () => {
  test.each(TRIP_SHAPES)("answering every core question makes a %s draftable", (shape) => {
    const answers = walk(QUESTION_TREE, { preset: { shape: choice(shape) }, coreOnly: true });
    const brief = toBrief(QUESTION_TREE, answers);

    expect(nextQuestion(QUESTION_TREE, answers).coreComplete).toBe(true);
    expect(missingRequiredSlots(brief)).toEqual([]);
  });

  test.each(DIVERGING_SHAPES)(
    "leaving any one core question out keeps a %s undraftable",
    (shape) => {
      const complete = walk(QUESTION_TREE, { preset: { shape: choice(shape) }, coreOnly: true });

      for (const id of Object.keys(complete)) {
        const answers = walk(QUESTION_TREE, {
          preset: { shape: choice(shape) },
          coreOnly: true,
          skip: [id],
        });

        expect(missingRequiredSlots(toBrief(QUESTION_TREE, answers)), id).not.toEqual([]);
        expect(nextQuestion(QUESTION_TREE, answers).coreComplete, id).toBe(false);
      }
    },
  );

  test("the essentials are eight questions or so, not twenty", () => {
    // §3's "perhaps eight to ten". A number that creeps up is the interview
    // this tool decided not to be, so it is asserted rather than hoped for.
    for (const shape of TRIP_SHAPES) {
      const answers = walk(QUESTION_TREE, { preset: { shape: choice(shape) }, coreOnly: true });
      expect(Object.keys(answers).length, shape).toBeLessThanOrEqual(10);
    }
  });

  test("refining carries on past the checkpoint, and reaches the end of the tree", () => {
    const answers = walk(QUESTION_TREE, { preset: { shape: choice("road-trip") } });
    const progress = nextQuestion(QUESTION_TREE, answers);

    expect(progress.coreComplete).toBe(true);
    expect(progress.node).toBeNull();
    expect(tripBriefSchema.safeParse(toBrief(QUESTION_TREE, answers)).success).toBe(true);
  });
});

describe("core and the contract's required slots describe the same set", () => {
  const coreTargets = QUESTION_TREE.nodes
    .filter((node) => node.stage === "core")
    .map((node) => node.fills);

  test("every core question fills a slot a first draft cannot do without", () => {
    for (const target of coreTargets) {
      const required: readonly string[] =
        target.scope === "core" ? REQUIRED_CORE_SLOTS : REQUIRED_SHAPE_SLOTS[target.shape];
      expect(required, JSON.stringify(target)).toContain(target.slot);
    }
  });

  test("every required slot is filled by a core question", () => {
    const filled = new Set(
      coreTargets.map((target) =>
        target.scope === "core" ? `core.${target.slot}` : `${target.shape}.${target.slot}`,
      ),
    );

    for (const slot of REQUIRED_CORE_SLOTS) expect(filled).toContain(`core.${slot}`);
    for (const shape of TRIP_SHAPES) {
      for (const slot of REQUIRED_SHAPE_SLOTS[shape]) {
        expect(filled).toContain(`${shape}.${slot}`);
      }
    }
  });

  test("a core question cannot be declined past", () => {
    // Declining settles a slot, and a settled slot is not missing. So a core
    // question that could be declined would let someone shrug their way to
    // "the essentials are done" over an empty brief.
    for (const node of QUESTION_TREE.nodes) {
      if (node.stage !== "core") continue;
      expect(() => validateAnswer(node, DECLINED, NOW), node.id).toThrow(/needed/i);
    }
  });

  test("a refine question can be declined, and is then never asked again", () => {
    const answers = walk(QUESTION_TREE, { preset: { shape: choice("resort") }, coreOnly: true });
    const first = nextQuestion(QUESTION_TREE, { ...answers });
    const refine = first.node;

    expect(refine).not.toBeNull();
    expect(refine?.stage).toBe("refine");

    const declined = { ...answers, [refine?.id ?? ""]: DECLINED };
    expect(nextQuestion(QUESTION_TREE, declined).node?.id).not.toBe(refine?.id);
  });
});

describe("shapes branch", () => {
  test.each(DIVERGING_SHAPES)("a %s asks its own questions and no other shape's", (shape) => {
    const answers = walk(QUESTION_TREE, { preset: { shape: choice(shape) } });
    const others = TRIP_SHAPES.filter((other) => other !== shape);

    for (const node of reachable(QUESTION_TREE, answers)) {
      if (node.fills.scope !== "shape") continue;
      expect(node.fills.shape, node.id).toBe(shape);
    }
    for (const other of others) {
      expect(
        Object.keys(answers).some((id) => id.startsWith(`${other}.`)),
        other,
      ).toBe(false);
    }
  });

  test("changing the shape strands the old shape's answers and keeps the core", () => {
    const before = walk(QUESTION_TREE, { preset: { shape: choice("backcountry") } });
    expect(before["backcountry.shelter"]).toBeDefined();

    const after = { ...before, shape: choice("city-and-culture") };
    const open = new Set(reachable(QUESTION_TREE, after).map((node) => node.id));

    expect(open.has("backcountry.shelter")).toBe(false);
    expect(open.has("city-and-culture.pace")).toBe(true);
    // The fixed core is shape-independent, which is the whole reason `shape` is
    // question one: who is coming and when did not change.
    for (const id of ["origin", "dates", "travellers", "budget", "effort"]) {
      expect(open.has(id), id).toBe(true);
    }
  });
});

test("the brief a walk produces is the brief the contract accepts", () => {
  for (const shape of TRIP_SHAPES) {
    const answers = walk(QUESTION_TREE, { preset: { shape: choice(shape as TripShape) } });
    const brief = toBrief(QUESTION_TREE, answers);

    expect(tripBriefSchema.safeParse(brief).success, shape).toBe(true);
    expect(brief.details?.shape, shape).toBe(shape);
  }
});
