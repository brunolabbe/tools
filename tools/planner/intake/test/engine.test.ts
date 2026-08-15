/**
 * Reachability, invalidation, and where the wizard is.
 *
 * These use small trees built for one point each — the checked-in tree is
 * exercised in `tree.test.ts`, and a rule is easier to disbelieve when the
 * counter-example is three questions long.
 */

import { describe, expect, test } from "vitest";
import type { Answers, QuestionNode } from "@planner/contract";
import { nextQuestion, prune, reachable } from "../src/engine.ts";
import { answered, DECLINED, text, textNode, treeOf } from "./helpers.ts";

const ids = (nodes: readonly QuestionNode[]): string[] => nodes.map((node) => node.id);

/** a → b → c, each opened by the last one's answer. */
const CHAIN = treeOf(
  textNode("a", null),
  textNode("b", { kind: "equals", question: "a", value: "yes" }),
  textNode("c", { kind: "equals", question: "b", value: "yes" }),
);

describe("reachable", () => {
  test("an unconditional question is always open", () => {
    expect(ids(reachable(CHAIN, {}))).toEqual(["a"]);
  });

  test("an answer opens what it should", () => {
    expect(ids(reachable(CHAIN, { a: text("yes") }))).toEqual(["a", "b"]);
  });

  test("a stale answer on a dead branch does not reopen the branch below it", () => {
    // The two-pass proof. `c` is gated on `b`, and `b` is now unreachable
    // because `a` changed. An implementation that evaluated `c` against every
    // stored answer would find b="yes" sitting there and keep `c` open — which
    // is the silent, plausible failure the whole ordering exists to prevent.
    const stale: Answers = { a: text("no"), b: text("yes"), c: text("yes") };
    expect(ids(reachable(CHAIN, stale))).toEqual(["a"]);
  });

  test("a declined answer settles the question without opening what it gates", () => {
    const tree = treeOf(textNode("a", null), textNode("b", { kind: "answered", question: "a" }));

    expect(ids(reachable(tree, { a: DECLINED }))).toEqual(["a"]);
    expect(ids(reachable(tree, { a: text("something") }))).toEqual(["a", "b"]);
  });

  test("conditions combine", () => {
    const both = treeOf(
      textNode("driving", null),
      textNode("season", null),
      textNode("winter-tyres", {
        kind: "all",
        of: [
          { kind: "equals", question: "driving", value: "yes" },
          { kind: "equals", question: "season", value: "winter" },
        ],
      }),
      textNode("either", {
        kind: "any",
        of: [
          { kind: "equals", question: "driving", value: "yes" },
          { kind: "equals", question: "season", value: "winter" },
        ],
      }),
      textNode("neither", {
        kind: "not",
        of: { kind: "equals", question: "driving", value: "yes" },
      }),
    );

    const driving = { driving: text("yes"), season: text("summer") };
    expect(ids(reachable(both, driving))).toEqual(["driving", "season", "either"]);

    const winterDrive = { driving: text("yes"), season: text("winter") };
    expect(ids(reachable(both, winterDrive))).toEqual([
      "driving",
      "season",
      "winter-tyres",
      "either",
    ]);

    expect(ids(reachable(both, { driving: text("no") }))).toContain("neither");
  });

  test("`includes` reads a list answer", () => {
    const tree = treeOf(
      textNode("interests", null),
      textNode("cooking-class", { kind: "includes", question: "interests", value: "food" }),
    );

    const food = answered({ kind: "text-list", values: ["food", "museums"] });
    expect(ids(reachable(tree, { interests: food }))).toContain("cooking-class");

    const museums = answered({ kind: "text-list", values: ["museums"] });
    expect(ids(reachable(tree, { interests: museums }))).not.toContain("cooking-class");
  });
});

describe("prune", () => {
  test("says exactly which answers a change discards", () => {
    const stale: Answers = { a: text("no"), b: text("yes"), c: text("yes") };
    const { kept, dropped } = prune(CHAIN, stale);

    expect(Object.keys(kept)).toEqual(["a"]);
    expect(dropped.map((entry) => entry.question)).toEqual(["b", "c"]);
    // By prompt and not by id is the UI's rule, so the node comes back with it.
    expect(dropped.map((entry) => entry.node?.prompt)).toEqual(["b?", "c?"]);
  });

  test("keeps everything when nothing was stranded", () => {
    const live: Answers = { a: text("yes"), b: text("yes"), c: text("yes") };
    const { kept, dropped } = prune(CHAIN, live);

    expect(Object.keys(kept)).toEqual(["a", "b", "c"]);
    expect(dropped).toEqual([]);
  });

  test("mutates nothing, so a preview can run before a write", () => {
    const stale: Answers = { a: text("no"), b: text("yes") };
    const copy = structuredClone(stale);

    prune(CHAIN, stale);
    expect(stale).toEqual(copy);
  });

  test("drops an answer whose question the tree no longer has", () => {
    // A saved intake meeting a newer tree. It has no node, so the UI has
    // nothing to name it by — which is a fact worth returning, not hiding.
    const { kept, dropped } = prune(CHAIN, { a: text("yes"), gone: text("whatever") });

    expect(Object.keys(kept)).toEqual(["a"]);
    expect(dropped).toEqual([{ question: "gone", node: null, answer: text("whatever") }]);
  });
});

describe("nextQuestion", () => {
  const tree = treeOf(
    textNode("one", null, "core"),
    textNode("two", null, "core"),
    textNode("three", null),
  );

  test("is the first reachable question with no answer", () => {
    expect(nextQuestion(tree, {}).node?.id).toBe("one");
    expect(nextQuestion(tree, { one: text("x") }).node?.id).toBe("two");
  });

  test("a declined question is answered, and is never asked again", () => {
    expect(nextQuestion(tree, { one: DECLINED }).node?.id).toBe("two");
  });

  test("is null when the tree is done", () => {
    const all = { one: text("x"), two: text("x"), three: text("x") };
    expect(nextQuestion(tree, all).node).toBeNull();
  });

  test("reports the checkpoint the wizard stops at", () => {
    expect(nextQuestion(tree, {}).coreComplete).toBe(false);
    expect(nextQuestion(tree, { one: text("x") }).coreComplete).toBe(false);

    const essentials = { one: text("x"), two: text("x") };
    const progress = nextQuestion(tree, essentials);

    // Core-complete with a question still to ask: that pair *is* the
    // checkpoint — the essentials are done and refining is still open.
    expect(progress.coreComplete).toBe(true);
    expect(progress.node?.id).toBe("three");
  });

  test("a core question on an unreachable branch does not hold the checkpoint", () => {
    const branched = treeOf(
      textNode("one", null, "core"),
      textNode("deep", { kind: "equals", question: "one", value: "deeper" }, "core"),
    );

    expect(nextQuestion(branched, { one: text("no") }).coreComplete).toBe(true);
    expect(nextQuestion(branched, { one: text("deeper") }).coreComplete).toBe(false);
  });
});
