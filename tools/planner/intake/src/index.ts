/**
 * `@planner/intake` — the authored question tree and the engine over it.
 *
 * The whole intake, with **no model, no network and no clock** in it (§3's
 * amendment). Give it a tree and a set of answers and it says what to ask next,
 * what an edit discards, and what brief the answers add up to — the same answer
 * every time, in a test, without a key.
 *
 * The order things happen in, for a caller writing an answer (pl-7):
 *
 * ```
 * answerSchema.parse(body)          // the contract, at the HTTP boundary
 * validateAnswer(node, answer, now) // this package: bounds, choices, dates
 * write the answer
 * prune(tree, answers)              // and delete the orphans, same transaction
 * nextQuestion / reachable / toBrief
 * ```
 *
 * `prune` before the write is the same call, and it is how the wizard warns
 * what a change costs before anything is lost. There must not be a second
 * implementation of it in the browser.
 */

export { QUESTION_TREE } from "./tree.ts";
export {
  nextQuestion,
  prune,
  reachable,
  type DroppedAnswer,
  type IntakeProgress,
} from "./engine.ts";
export { toBrief } from "./brief.ts";
export { validateAnswer } from "./answer.ts";
export { validateTree } from "./validate.ts";
