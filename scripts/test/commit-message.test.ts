import { expect, test } from "vitest";
import { validate } from "../commit-message.mjs";

// Fixed so the suite does not change meaning when a tool is added to the repo.
const scopes = ["downloader", "planner", "core", "repo", "ci", "deps"];
const check = (message: string) => validate(message, { scopes });

test("accepts a conventional subject with a known scope", () => {
  expect(check("fix(downloader): stop re-probing in place (dl-9)")).toEqual({
    ok: true,
    errors: [],
  });
});

test("accepts a scopeless commit for a type that does not reach a changelog", () => {
  expect(check("docs: give every tool its own roadmap").ok).toBe(true);
});

test("requires a scope on the two types that move a version", () => {
  for (const type of ["feat", "fix"]) {
    const { ok, errors } = check(`${type}: add a thing`);
    expect(ok).toBe(false);
    expect(errors.join(" ")).toContain("needs a scope");
  }
});

test("rejects a type nobody has agreed on", () => {
  // This repo's own history has `security:`, which release-please would drop on
  // the floor. It is a `fix`.
  const { ok, errors } = check("security(downloader): pin vetted addresses");
  expect(ok).toBe(false);
  expect(errors.join(" ")).toContain('"security" is not a known type');
});

test("rejects a scope that is not a tool or a known area", () => {
  const { ok, errors } = check("feat(dowloader): add a thing");
  expect(ok).toBe(false);
  expect(errors.join(" ")).toContain('"dowloader" is not a known scope');
});

test("rejects anything that is not a conventional header at all", () => {
  const { ok, errors } = check("dl-10: wire up releases");
  expect(ok).toBe(false);
  expect(errors.join(" ")).toContain("is not a conventional commit");
});

test("accepts a breaking change marked with a bang", () => {
  expect(check("feat(planner)!: drop the scripted provider").ok).toBe(true);
});

test("catches a BREAKING CHANGE footer that would be silently ignored", () => {
  const { ok, errors } = check(
    ["feat(core): rework the error taxonomy", "", "Breaking change: codes moved"].join("\n"),
  );
  expect(ok).toBe(false);
  expect(errors.join(" ")).toContain("silently will not happen");
});

test("leaves a correctly spelled BREAKING CHANGE footer alone", () => {
  expect(
    check(["feat(core): rework the error taxonomy", "", "BREAKING CHANGE: codes moved"].join("\n"))
      .ok,
  ).toBe(true);
});

test("rejects a subject that is capitalised or ends in a full stop", () => {
  expect(check("fix(planner): Add the conversation loop").ok).toBe(false);
  expect(check("fix(planner): add the conversation loop.").ok).toBe(false);
});

test("passes through what git generates for merges and reverts", () => {
  expect(check("Merge branch 'main' into per-tool-docs").ok).toBe(true);
  expect(check('Revert "feat(planner): scaffold a second tool"').ok).toBe(true);
  expect(check("fixup! fix(downloader): stop re-probing").ok).toBe(true);
});

test("ignores the comment block git appends to the message buffer", () => {
  const message = [
    "chore(repo): pin the toolchain",
    "",
    "# Please enter the commit message for your changes. Lines starting",
    "# with '#' will be ignored, and an empty message aborts the commit.",
  ].join("\n");
  expect(check(message).ok).toBe(true);
});

test("does not count GitHub's squash suffix against the length limit", () => {
  const subject = `fix(downloader): ${"a".repeat(80)}`;
  expect(subject.length).toBeLessThanOrEqual(100);
  expect(check(`${subject} (#1234)`).ok).toBe(true);

  const tooLong = `fix(downloader): ${"a".repeat(90)}`;
  expect(check(`${tooLong} (#1234)`).ok).toBe(false);
});

test("an empty message is rejected rather than crashing", () => {
  expect(check("").ok).toBe(false);
  expect(check("\n\n").ok).toBe(false);
});

test("scope validation is skipped when the tool list cannot be read", () => {
  // `toolScopes()` returns [] outside the repo; an unknown scope must not then
  // block every commit on a bad guess about where it is running.
  expect(validate("feat(whatever): a thing", { scopes: [] }).ok).toBe(true);
});
