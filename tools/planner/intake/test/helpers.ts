/**
 * Shared fixtures for the intake's tests.
 *
 * Not a test file — `vitest` collects `*.test.ts` only, and this is the tree
 * walking every suite needs and none of them should re-implement.
 */

import type {
  Answer,
  AnswerValue,
  Condition,
  QuestionNode,
  QuestionTree,
  TripShape,
} from "@planner/contract";
import { reachable } from "../src/engine.ts";

export function answered(value: AnswerValue): Answer {
  return { state: "answered", value };
}

export function choice(value: string): Answer {
  return answered({ kind: "single-choice", value });
}

export function text(value: string): Answer {
  return answered({ kind: "text", value });
}

export const DECLINED: Answer = { state: "declined" };

/**
 * An answer this question would accept — the first choice, the smallest number,
 * a word of text. Deliberately boring: what the suites assert about is which
 * questions get asked, not what was said.
 */
export function answerFor(node: QuestionNode): Answer {
  switch (node.kind) {
    case "single-choice":
      return choice(node.choices[0]?.value ?? "");
    case "multi-choice":
      return answered({ kind: "multi-choice", values: [node.choices[0]?.value ?? ""] });
    case "text":
      return text("something");
    case "text-list":
      return answered({ kind: "text-list", values: ["something"] });
    case "number":
      return answered({ kind: "number", value: node.min });
    case "number-list":
      return answered({ kind: "number-list", values: [node.min] });
    case "dates":
      return answered({ kind: "dates", value: { kind: "open", nights: 5 } });
    case "budget":
      return answered({ kind: "budget", value: { kind: "band", band: "moderate" } });
  }
}

/**
 * Answer the tree the way a user would — one reachable question at a time,
 * re-deciding what is reachable after each one, because that is what the wizard
 * does and it is the only way a branch opens.
 */
export function walk(
  tree: QuestionTree,
  options: {
    /** Answers to use instead of the generated one, by question id. */
    preset?: Record<string, Answer>;
    /** Stop after the essentials, the way the checkpoint does. */
    coreOnly?: boolean;
    /** Question ids to leave unanswered. */
    skip?: readonly string[];
  } = {},
): Record<string, Answer> {
  const { preset = {}, coreOnly = false, skip = [] } = options;
  const answers: Record<string, Answer> = {};

  // One question per turn, and the tree is finite: the bound is the node count.
  for (let turn = 0; turn < tree.nodes.length; turn += 1) {
    const next = reachable(tree, answers).find(
      (node) =>
        answers[node.id] === undefined &&
        !skip.includes(node.id) &&
        (!coreOnly || node.stage === "core"),
    );
    if (next === undefined) break;
    answers[next.id] = preset[next.id] ?? answerFor(next);
  }

  return answers;
}

/** The shapes' first divergence: these two share the core and nothing after it. */
export const DIVERGING_SHAPES: readonly TripShape[] = ["backcountry", "city-and-culture"];

// ---------------------------------------------------------------------------
// Trees built for one point each. The real tree is `QUESTION_TREE`.
// ---------------------------------------------------------------------------

/**
 * A synthetic text question, for suites that care about the walking.
 *
 * The slot follows the stage, and that is not arbitrary. Since pl-18 the
 * checkpoint and the decline rule read `isRequiredSlot(node.fills)` rather than
 * `stage`, so a `core` node has to fill a slot a draft actually needs for these
 * trees to model what their tests mean by "core". `destination` — the slot this
 * used to hand out unconditionally — is the one early question that is *not*
 * required, which would make every synthetic core node optional.
 */
export function textNode(
  id: string,
  when: Condition | null,
  stage: "core" | "refine" = "refine",
): QuestionNode {
  return {
    id,
    prompt: `${id}?`,
    help: null,
    when,
    fills: { scope: "core", slot: stage === "core" ? "origin" : "destination" },
    stage,
    kind: "text",
    maxLength: 100,
  };
}

export function treeOf(...nodes: QuestionNode[]): QuestionTree {
  return { version: 1, nodes };
}
