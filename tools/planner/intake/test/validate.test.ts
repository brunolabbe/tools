/**
 * The tree validator, one malformed tree per rule.
 *
 * Each case starts from the checked-in tree and breaks exactly one thing, so a
 * failure here names the rule rather than a pile of unrelated complaints.
 */

import { expect, test } from "vitest";
import type { CoreSlotId, QuestionNode, QuestionTree } from "@planner/contract";
import { QUESTION_TREE } from "../src/tree.ts";
import { validateTree } from "../src/validate.ts";
import { textNode, treeOf } from "./helpers.ts";

function expectProblem(tree: QuestionTree, snippet: string): void {
  expect(validateTree(tree).join("\n")).toContain(snippet);
}

function replacing(id: string, change: (node: QuestionNode) => QuestionNode): QuestionTree {
  return {
    ...QUESTION_TREE,
    nodes: QUESTION_TREE.nodes.map((node) => (node.id === id ? change(node) : node)),
  };
}

function nodeById(id: string): QuestionNode {
  const node = QUESTION_TREE.nodes.find((each) => each.id === id);
  if (node === undefined) throw new Error(`no such question: ${id}`);
  return node;
}

test("a version that is not a positive integer", () => {
  expectProblem({ ...QUESTION_TREE, version: 0 }, "positive integer");
});

test("an id that will not survive a URL", () => {
  expectProblem(
    replacing("origin", (node) => ({ ...node, id: "Origin!" })),
    "not a usable question id",
  );
});

test("a duplicate question id", () => {
  const first = QUESTION_TREE.nodes[0];
  if (first === undefined) throw new Error("the tree is empty");

  expectProblem({ ...QUESTION_TREE, nodes: [...QUESTION_TREE.nodes, first] }, "share this id");
});

test("two questions filling one slot", () => {
  const twin = { ...nodeById("origin"), id: "origin-again" };
  expectProblem(
    { ...QUESTION_TREE, nodes: [...QUESTION_TREE.nodes, twin] },
    "which origin already fills",
  );
});

test("a condition on a question that does not exist", () => {
  const broken = replacing("comfort", (node) => ({
    ...node,
    when: { kind: "answered", question: "nope" },
  }));

  expectProblem(broken, "which is not a question");
});

test("a condition on a question that comes later", () => {
  // The rule the whole engine rests on: references point backwards, so
  // reachability is one forward pass.
  const broken = replacing("origin", (node) => ({
    ...node,
    when: { kind: "answered", question: "effort" },
  }));

  expectProblem(broken, "comes later in the tree");
});

test("a question filling a slot the brief does not have", () => {
  const broken = replacing("origin", (node) => ({
    ...node,
    fills: { scope: "core", slot: "nickname" as CoreSlotId },
  }));

  expectProblem(broken, "not a slot on the brief");
});

test("a choice question with no choices", () => {
  const broken = replacing("effort", (node) => ({
    ...(node as Extract<QuestionNode, { kind: "single-choice" }>),
    choices: [],
  }));

  expectProblem(broken, "a choice question with no choices");
});

test("a number question whose bounds are the wrong way round", () => {
  const broken = replacing("travellers", (node) => ({
    ...(node as Extract<QuestionNode, { kind: "number" }>),
    min: 30,
    max: 1,
  }));

  expectProblem(broken, "min is above max");
});

test("a shape's question that is not gated on that shape", () => {
  // Without the gate it would be asked on a resort week and its answer would
  // have nowhere to land — the brief carries one shape's extension.
  expectProblem(
    replacing("backcountry.shelter", (node) => ({ ...node, when: null })),
    "not gated on that shape",
  );
});

test("a core question gated behind a refine question", () => {
  // If a question the draft cannot do without sits behind one the user was
  // invited to skip, `core` has stopped meaning anything.
  const broken = treeOf(textNode("optional", null, "refine"), {
    ...nodeById("shape"),
    when: { kind: "answered", question: "optional" },
  });

  expectProblem(broken, "a core question gated behind optional, which is refine");
});

test("a core question filling a slot no draft needs is allowed", () => {
  // The direction pl-18 retired, asserted as permission rather than deleted:
  // an early *optional* question is a shape the tree may have, and
  // `destination` is the checked-in one. Deleting this case instead would let
  // the old rule come back with nothing to notice.
  expect(validateTree(QUESTION_TREE)).toEqual([]);
  expect(nodeById("destination").stage).toBe("core");
});

test("a core question after a refine question", () => {
  // The other half of that trade. `stage` is a position now, so a core question
  // the wizard would only reach past the checkpoint is the lie that rule used
  // to catch for free.
  const nodes = QUESTION_TREE.nodes.filter((node) => node.id !== "origin");
  const broken = { ...QUESTION_TREE, nodes: [...nodes, nodeById("origin")] };

  expectProblem(broken, "a core question after budget, which is refine");
});

test("a required slot no core question fills", () => {
  expectProblem(
    replacing("origin", (node) => ({ ...node, stage: "refine" })),
    "no core question fills it",
  );
});

test("a tree with no shape question at all", () => {
  expectProblem(treeOf(textNode("something", null)), "No question fills the trip's shape");
});

test("a shape question that does not offer every shape", () => {
  const broken = replacing("shape", (node) => ({
    ...(node as Extract<QuestionNode, { kind: "single-choice" }>),
    choices: [{ value: "road-trip", label: "A road trip" }],
  }));

  expectProblem(broken, "does not offer");
});
