/**
 * Walking the tree: what to ask, what an edit discards, and where to stop.
 *
 * Everything here is a pure function of `(tree, answers)`. No database, no
 * network, no clock — the clock lives in `validateAnswer`, which takes `now` as
 * an argument.
 *
 * ## One forward pass, and why that is enough
 *
 * A condition may reference only questions appearing **earlier** in the tree
 * (`validateTree` enforces it). So a single pass in tree order can decide
 * reachability: by the time a node is reached, every answer its condition can
 * mention has already been seen and already been judged reachable or not.
 *
 * The judging is the part that matters. A node's condition is evaluated against
 * the answers to *earlier reachable* nodes only. Evaluating against all stored
 * answers instead is precisely the bug this ordering prevents: a stale answer
 * sitting on an abandoned branch would resurrect the branch below it, and the
 * store would go on holding answers to questions nobody would ask — silent, and
 * plausible, which §7 calls the worst kind of failure.
 */

import {
  isRequiredSlot,
  type Answer,
  type Answers,
  type Condition,
  type QuestionId,
  type QuestionNode,
  type QuestionTree,
} from "@planner/contract";

/**
 * The answers to earlier reachable nodes — the only thing a condition may see.
 * A `Map` rather than the caller's record so there is no chance of reading an
 * answer that has not been judged yet.
 */
type LiveAnswers = ReadonlyMap<QuestionId, Answer>;

/** The text an `equals` compares against, or null when the answer has no text. */
function scalarText(answer: Answer | undefined): string | null {
  if (answer === undefined || answer.state !== "answered") return null;
  const { value } = answer;
  return value.kind === "single-choice" || value.kind === "text" ? value.value : null;
}

/** The values an `includes` searches, or null when the answer is not a list. */
function listValues(answer: Answer | undefined): readonly string[] | null {
  if (answer === undefined || answer.state !== "answered") return null;
  const { value } = answer;
  return value.kind === "multi-choice" || value.kind === "text-list" ? value.values : null;
}

function evaluate(condition: Condition, live: LiveAnswers): boolean {
  switch (condition.kind) {
    case "equals":
      return scalarText(live.get(condition.question)) === condition.value;
    case "includes":
      return listValues(live.get(condition.question))?.includes(condition.value) ?? false;
    // A declined question is settled but holds no value, so it does not open
    // what an answer would have opened. See `Condition` in the contract.
    case "answered":
      return live.get(condition.question)?.state === "answered";
    case "all":
      return condition.of.every((each) => evaluate(each, live));
    case "any":
      return condition.of.some((each) => evaluate(each, live));
    case "not":
      return !evaluate(condition.of, live);
  }
}

/**
 * The questions these answers open, in tree order.
 *
 * Includes the ones already answered — this is "which questions apply", not
 * "what is left to do". `nextQuestion` is the second one.
 */
export function reachable(tree: QuestionTree, answers: Answers): QuestionNode[] {
  const open: QuestionNode[] = [];
  const live = new Map<QuestionId, Answer>();

  for (const node of tree.nodes) {
    if (node.when !== null && !evaluate(node.when, live)) continue;
    open.push(node);
    const answer = answers[node.id];
    if (answer !== undefined) live.set(node.id, answer);
  }

  return open;
}

/** An answer that no longer answers anything, and the question it was for. */
export type DroppedAnswer = {
  question: QuestionId;
  /**
   * The node it belonged to, or `null` when the tree no longer has that
   * question at all — the shape of a saved intake meeting a newer tree. The UI
   * names an answer by its prompt, so a dropped answer with no node is the one
   * case it has nothing to name.
   */
  node: QuestionNode | null;
  answer: Answer;
};

/**
 * Which answers survive these answers, and which no longer answer anything.
 *
 * Returns both halves and mutates nothing, because the wizard has to be able to
 * say "changing this discards these four" *before* anything is written — and
 * the list it shows must come from this function rather than from a second
 * implementation in the browser.
 *
 * `dropped` comes back in tree order, then any answers whose question the tree
 * no longer has.
 */
export function prune(
  tree: QuestionTree,
  answers: Answers,
): {
  kept: Answers;
  dropped: DroppedAnswer[];
} {
  const open = new Set(reachable(tree, answers).map((node) => node.id));
  const kept: Record<QuestionId, Answer> = {};
  const dropped: DroppedAnswer[] = [];

  for (const node of tree.nodes) {
    const answer = answers[node.id];
    if (answer === undefined) continue;
    if (open.has(node.id)) kept[node.id] = answer;
    else dropped.push({ question: node.id, node, answer });
  }

  const known = new Set(tree.nodes.map((node) => node.id));
  for (const [question, answer] of Object.entries(answers)) {
    if (!known.has(question)) dropped.push({ question, node: null, answer });
  }

  return { kept, dropped };
}

/** Where the wizard is: what to ask next, and whether it may stop. */
export type IntakeProgress = {
  /** The first reachable question with no answer. `null` means the tree is done. */
  node: QuestionNode | null;
  /**
   * True when nothing reachable that a draft **needs** is still unanswered — the
   * checkpoint where the wizard says the essentials are done and offers it.
   *
   * "Needs" is `isRequiredSlot`, not `stage`. The two were the same set until
   * pl-18, and reading `stage` here would now hold the checkpoint open for
   * `destination`, which is asked early precisely because it may be skipped.
   *
   * Computed here rather than by filtering the reachable set in the browser,
   * for the same reason nothing else about the tree is evaluated there: one
   * implementation, on the side that owns the tree.
   *
   * It is a fact about the answers, never a stored state. Refining is somewhere
   * a user comes back to, so this can be true while `node` still holds a
   * `refine` question — that pair *is* the checkpoint.
   */
  coreComplete: boolean;
};

/**
 * The next question, and whether the essentials are done.
 *
 * A question that was asked and **declined** counts as answered and is never
 * put again. That is the whole point of the three-state slot, and re-asking a
 * declined question is the most visible way this tool can look stupid.
 */
export function nextQuestion(tree: QuestionTree, answers: Answers): IntakeProgress {
  let node: QuestionNode | null = null;
  let coreComplete = true;

  for (const candidate of reachable(tree, answers)) {
    if (answers[candidate.id] !== undefined) continue;
    node ??= candidate;
    // An early *optional* question does not hold the checkpoint open, so this
    // cannot break on `stage` — it has to keep looking for a required one.
    if (isRequiredSlot(candidate.fills)) {
      coreComplete = false;
      break;
    }
  }

  return { node, coreComplete };
}
