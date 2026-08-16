/**
 * The checked-in tree, held to what the wizard promises about it.
 *
 * The load-bearing claim is that every required slot is filled by a question
 * asked before the checkpoint: the wizard stops when nothing reachable that the
 * draft needs is unanswered and says the essentials are done, and if a required
 * slot could sit behind that line the sentence is a lie.
 *
 * The converse was load-bearing too until pl-18 and is not any more — a question
 * asked early need not be one the draft needs. `destination` is the case, and
 * the set of such questions is enumerated below rather than asserted empty.
 */

import { describe, expect, test } from "vitest";
import {
  isRequiredSlot,
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

/** How many questions this shape answers before the checkpoint lets it stop. */
function coreQuestionCount(shape: TripShape): number {
  return Object.keys(walk(QUESTION_TREE, { preset: { shape: choice(shape) }, coreOnly: true }))
    .length;
}

/** How many of those the draft actually needs — the rest may be skipped. */
function requiredQuestionCount(shape: TripShape): number {
  const answers = walk(QUESTION_TREE, { preset: { shape: choice(shape) }, coreOnly: true });

  return QUESTION_TREE.nodes.filter(
    (node) => answers[node.id] !== undefined && isRequiredSlot(node.fills),
  ).length;
}

test("the checked-in tree is valid", () => {
  expect(validateTree(QUESTION_TREE)).toEqual([]);
});

test("the first three questions are the shape, where from, and where to", () => {
  // pl-18's whole claim is a position, and `validateTree` cannot check one — its
  // ordering rule only says core-before-refine, which a destination asked
  // eighteenth would also satisfy. Without this the claim is true only by
  // reading the tree, which is how it silently drifts back.
  expect(QUESTION_TREE.nodes.slice(0, 3).map((node) => node.id)).toEqual([
    "shape",
    "origin",
    "destination",
  ]);
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
    "leaving any one needed question out keeps a %s undraftable",
    (shape) => {
      const complete = walk(QUESTION_TREE, { preset: { shape: choice(shape) }, coreOnly: true });

      for (const id of Object.keys(complete)) {
        // Skipping `destination` is the one omission that must *not* hold the
        // checkpoint open — it is asked early and stays optional (pl-18), and
        // the case below asserts exactly that rather than leaving it untested.
        const node = QUESTION_TREE.nodes.find((each) => each.id === id);
        if (node === undefined || !isRequiredSlot(node.fills)) continue;

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

  test.each(TRIP_SHAPES)("skipping the destination still leaves a %s draftable", (shape) => {
    // The other half of the leave-one-out sweep above, and the behaviour pl-18
    // exists for: the question is in front of the user early, and passing on it
    // costs nothing.
    const answers = walk(QUESTION_TREE, {
      preset: { shape: choice(shape) },
      coreOnly: true,
      skip: ["destination"],
    });

    expect(nextQuestion(QUESTION_TREE, answers).coreComplete).toBe(true);
    expect(missingRequiredSlots(toBrief(QUESTION_TREE, answers))).toEqual([]);
  });

  test("the essentials are seven questions or so, not twenty", () => {
    // §3's "perhaps eight to ten". A number that creeps up is the interview
    // this tool decided not to be, so it is asserted rather than hoped for.
    for (const shape of TRIP_SHAPES) {
      const answers = walk(QUESTION_TREE, { preset: { shape: choice(shape) }, coreOnly: true });
      expect(Object.keys(answers).length, shape).toBeLessThanOrEqual(10);
    }
  });

  test("a road trip reaches it in eight asked and seven needed, a resort in seven and six", () => {
    // The exact counts, because the content review of 2026-08-16 moved one and
    // split another, and "eight to ten" is too loose to notice a third arriving.
    //
    // Asked and needed are two numbers since pl-18, and the gap between them is
    // `destination` — asked third, skippable. If they ever match again, either
    // it became required or it went back behind the checkpoint.
    expect(coreQuestionCount("road-trip")).toBe(8);
    expect(coreQuestionCount("resort")).toBe(7);

    expect(requiredQuestionCount("road-trip")).toBe(7);
    expect(requiredQuestionCount("resort")).toBe(6);
  });

  test("refining carries on past the checkpoint, and reaches the end of the tree", () => {
    const answers = walk(QUESTION_TREE, { preset: { shape: choice("road-trip") } });
    const progress = nextQuestion(QUESTION_TREE, answers);

    expect(progress.coreComplete).toBe(true);
    expect(progress.node).toBeNull();
    expect(tripBriefSchema.safeParse(toBrief(QUESTION_TREE, answers)).success).toBe(true);
  });
});

describe("every required slot is asked before the checkpoint", () => {
  const coreTargets = QUESTION_TREE.nodes
    .filter((node) => node.stage === "core")
    .map((node) => node.fills);

  test("the questions asked early that a draft does not need are the ones we meant", () => {
    // pl-18 retired the converse — a core question no longer has to fill a
    // required slot — so the set that used to be empty is now enumerated
    // instead. A new arrival here is a question someone made mandatory-looking
    // by putting it early, and it should be argued for in a ticket first.
    const optional = coreTargets.filter((target) => !isRequiredSlot(target));

    expect(optional).toEqual([{ scope: "core", slot: "destination" }]);
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

  test("a question the draft needs cannot be declined past", () => {
    // Declining settles a slot, and a settled slot is not missing. So a required
    // question that could be declined would let someone shrug their way to
    // "the essentials are done" over an empty brief.
    for (const node of QUESTION_TREE.nodes) {
      if (!isRequiredSlot(node.fills)) continue;
      expect(() => validateAnswer(node, DECLINED, NOW), node.id).toThrow(/needed/i);
    }
  });

  test("an early question the draft does not need can be declined", () => {
    // The point of pl-18: `destination` is asked third and may still be left
    // blank. If this ever throws, the decline rule has gone back to reading
    // `stage` and the question has become mandatory by accident.
    const destination = QUESTION_TREE.nodes.find((node) => node.id === "destination");
    if (destination === undefined) throw new Error("the tree has no destination question");

    expect(destination.stage).toBe("core");
    expect(() => validateAnswer(destination, DECLINED, NOW)).not.toThrow();
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
    // The fixed core is shape-independent — every one of these carries
    // `when: null`, which is what puts it out of `prune`'s reach. Note that this
    // is a property of the conditions and of `withShape`, not of `shape` being
    // question one: it would hold just as well if it were asked sixth.
    for (const id of ["origin", "dates", "travellers", "effort"]) {
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
