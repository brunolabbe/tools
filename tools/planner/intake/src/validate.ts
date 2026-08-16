/**
 * Is this tree a tree we can walk?
 *
 * Run as a **test**, not at boot. The tree is checked-in content compiled into
 * the image: a malformed one is a mistake to catch in review, and a service
 * that refuses to start over a question's wording helps nobody at three in the
 * morning.
 *
 * Every problem is returned rather than thrown, so one run names all of them
 * instead of the first. An empty array is a valid tree.
 */

import {
  emptyBrief,
  emptyShapeDetails,
  REQUIRED_CORE_SLOTS,
  REQUIRED_SHAPE_SLOTS,
  TRIP_SHAPES,
  type Condition,
  type QuestionId,
  type QuestionNode,
  type QuestionTree,
  type SlotTarget,
  type TripShape,
} from "@planner/contract";

/** Lower-case, dot-separated: `shape`, `road-trip.drive-hours`. Ids reach URLs. */
const ID_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

/**
 * The brief's own slot names, read off the brief rather than restated.
 * A slot renamed in the contract shows up here on the next run.
 */
const CORE_SLOTS: ReadonlySet<string> = new Set(
  Object.keys(emptyBrief()).filter((key) => key !== "details"),
);

const SHAPE_SLOTS: ReadonlyMap<TripShape, ReadonlySet<string>> = new Map(
  TRIP_SHAPES.map((shape) => [
    shape,
    new Set(Object.keys(emptyShapeDetails(shape)).filter((key) => key !== "shape")),
  ]),
);

function targetKey(target: SlotTarget): string {
  return target.scope === "core" ? `core.${target.slot}` : `${target.shape}.${target.slot}`;
}

/** Every question a condition reads. */
function references(condition: Condition): QuestionId[] {
  switch (condition.kind) {
    case "equals":
    case "includes":
    case "answered":
      return [condition.question];
    case "all":
    case "any":
      return condition.of.flatMap(references);
    case "not":
      return references(condition.of);
  }
}

/**
 * The conditions that must *all* hold, flattened out of nested `all`s.
 *
 * Only used to ask whether a shape branch is properly gated. Deliberately not
 * clever: an `any` or a `not` around the gate is not a gate this can see, and
 * the check below then says so rather than guessing.
 */
function conjuncts(condition: Condition): Condition[] {
  return condition.kind === "all" ? condition.of.flatMap(conjuncts) : [condition];
}

function slotExists(target: SlotTarget): boolean {
  return target.scope === "core"
    ? CORE_SLOTS.has(target.slot)
    : (SHAPE_SLOTS.get(target.shape)?.has(target.slot) ?? false);
}

export function validateTree(tree: QuestionTree): string[] {
  const problems: string[] = [];
  const { nodes } = tree;

  if (!Number.isInteger(tree.version) || tree.version < 1) {
    problems.push(`The tree version must be a positive integer, not ${String(tree.version)}.`);
  }

  const positions = new Map<QuestionId, number>();
  const targets = new Map<string, QuestionId>();

  nodes.forEach((node, position) => {
    if (!ID_PATTERN.test(node.id)) problems.push(`${node.id}: not a usable question id.`);

    const first = positions.get(node.id);
    if (first === undefined) positions.set(node.id, position);
    else problems.push(`${node.id}: two questions share this id.`);

    if (node.prompt.trim().length === 0) problems.push(`${node.id}: has no prompt.`);

    if (!slotExists(node.fills)) {
      problems.push(
        `${node.id}: fills ${targetKey(node.fills)}, which is not a slot on the brief.`,
      );
    }

    // Two questions writing one slot is last-answer-wins in `toBrief`, and
    // which one wins depends on tree order — a silent way to lose an answer.
    const owner = targets.get(targetKey(node.fills));
    if (owner === undefined) targets.set(targetKey(node.fills), node.id);
    else problems.push(`${node.id}: fills ${targetKey(node.fills)}, which ${owner} already fills.`);

    problems.push(...validateShapeOfKind(node));
  });

  problems.push(...validateConditions(nodes, positions));
  problems.push(...validateShapeGates(nodes));
  problems.push(...validateCoreMarking(nodes));

  return problems;
}

/** The bounds a control needs, and the ones a question is useless without. */
function validateShapeOfKind(node: QuestionNode): string[] {
  const problems: string[] = [];

  switch (node.kind) {
    case "single-choice":
    case "multi-choice": {
      if (node.choices.length === 0)
        problems.push(`${node.id}: a choice question with no choices.`);
      const values = node.choices.map((choice) => choice.value);
      if (new Set(values).size !== values.length) {
        problems.push(`${node.id}: two choices share a value.`);
      }
      if (node.choices.some((choice) => choice.label.trim().length === 0)) {
        problems.push(`${node.id}: a choice with no label.`);
      }
      break;
    }
    case "text":
      if (node.maxLength < 1) problems.push(`${node.id}: maxLength must be at least 1.`);
      break;
    case "text-list":
      if (node.maxLength < 1) problems.push(`${node.id}: maxLength must be at least 1.`);
      if (node.maxItems < 1) problems.push(`${node.id}: maxItems must be at least 1.`);
      break;
    case "number":
      if (node.min > node.max) problems.push(`${node.id}: min is above max.`);
      break;
    case "number-list":
      if (node.min > node.max) problems.push(`${node.id}: min is above max.`);
      if (node.maxItems < 1) problems.push(`${node.id}: maxItems must be at least 1.`);
      break;
    case "dates":
    case "budget":
      break;
  }

  return problems;
}

/**
 * References point backwards, and only at questions that exist.
 *
 * This is the rule the whole engine rests on: with it, reachability is one
 * forward pass. Without it, a condition could read an answer that has not been
 * judged reachable yet, and the tree would need a fixpoint and a cycle check.
 */
function validateConditions(
  nodes: readonly QuestionNode[],
  positions: ReadonlyMap<QuestionId, number>,
): string[] {
  const problems: string[] = [];

  nodes.forEach((node, position) => {
    if (node.when === null) return;
    for (const question of references(node.when)) {
      const referenced = positions.get(question);
      if (referenced === undefined) {
        problems.push(`${node.id}: asks about ${question}, which is not a question.`);
      } else if (referenced >= position) {
        problems.push(`${node.id}: asks about ${question}, which comes later in the tree.`);
      }
    }
  });

  return problems;
}

/**
 * A shape's question is gated on that shape.
 *
 * Without this, a question about hut bookings could be reachable on a resort
 * week — and its answer would have nowhere to land, because the brief carries
 * one shape's extension and no other's.
 */
function validateShapeGates(nodes: readonly QuestionNode[]): string[] {
  const problems: string[] = [];

  // A second one is already a problem — two questions cannot fill one slot —
  // so the first is the one every branch is read against.
  const shapeQuestion = nodes.find(
    (node) => node.fills.scope === "core" && node.fills.slot === "shape",
  );

  if (shapeQuestion === undefined) {
    problems.push("No question fills the trip's shape, so no branch can be gated.");
    return problems;
  }
  if (shapeQuestion.kind !== "single-choice") {
    problems.push(`${shapeQuestion.id}: the shape question must offer a choice of shapes.`);
  } else {
    const offered = new Set(shapeQuestion.choices.map((choice) => choice.value));
    const missing = TRIP_SHAPES.filter((shape) => !offered.has(shape));
    if (missing.length > 0) {
      problems.push(`${shapeQuestion.id}: does not offer ${missing.join(", ")}.`);
    }
  }

  for (const node of nodes) {
    const target = node.fills;
    if (target.scope !== "shape") continue;

    const gated =
      node.when !== null &&
      conjuncts(node.when).some(
        (condition) =>
          condition.kind === "equals" &&
          condition.question === shapeQuestion.id &&
          condition.value === target.shape,
      );

    if (!gated) {
      problems.push(`${node.id}: fills a ${target.shape} slot but is not gated on that shape.`);
    }
  }

  return problems;
}

/**
 * The checkpoint tells the truth.
 *
 * The wizard stops when nothing reachable that a draft needs is unanswered, and
 * tells the user the essentials are done. **Every required slot must therefore
 * be filled by a `core` node** — a required slot behind the checkpoint means
 * offering a draft `missingRequiredSlots` will refuse.
 *
 * The converse is not checked, and its absence is the point of pl-18: a `core`
 * node whose slot is not required is an early *optional* question — asked before
 * the draft because the user is ready to answer it, skippable because the plan
 * survives without it. `destination` is the case that earned this.
 *
 * Two orderings still have to hold, and both are checked here because nothing
 * else does. A `core` question gated behind a `refine` one is a question the
 * draft needs, sitting behind one the user was invited to skip. And a `core`
 * question placed after a `refine` one is never reached before the checkpoint at
 * all, which makes `stage` a label rather than a position — the one job it still
 * has after this ticket.
 */
function validateCoreMarking(nodes: readonly QuestionNode[]): string[] {
  const problems: string[] = [];
  const stages = new Map(nodes.map((node) => [node.id, node.stage]));

  let firstRefine: QuestionNode | null = null;

  for (const node of nodes) {
    if (node.stage === "refine") {
      firstRefine ??= node;
      continue;
    }

    if (firstRefine !== null) {
      problems.push(`${node.id}: a core question after ${firstRefine.id}, which is refine.`);
    }

    if (node.when === null) continue;
    for (const question of references(node.when)) {
      if (stages.get(question) === "refine") {
        problems.push(`${node.id}: a core question gated behind ${question}, which is refine.`);
      }
    }
  }

  const filledByCore = new Set(
    nodes.filter((node) => node.stage === "core").map((node) => targetKey(node.fills)),
  );

  for (const slot of REQUIRED_CORE_SLOTS) {
    if (!filledByCore.has(`core.${slot}`)) {
      problems.push(`${slot} is required for a draft, but no core question fills it.`);
    }
  }

  for (const shape of TRIP_SHAPES) {
    for (const slot of REQUIRED_SHAPE_SLOTS[shape]) {
      if (!filledByCore.has(`${shape}.${slot}`)) {
        problems.push(`${shape}.${slot} is required for a draft, but no core question fills it.`);
      }
    }
  }

  return problems;
}
