import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { releasingTypes, TYPES, validate } from "../commit-message.mjs";

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

test("requires a scope on every type that reaches a changelog", () => {
  // `perf` and `revert` are here because repo-10 measured them reaching one —
  // they were not required to carry a scope while they did, which is the defect
  // deriving this set from the config closes.
  for (const type of ["feat", "fix", "perf", "revert"]) {
    const { ok, errors } = check(`${type}: add a thing`);
    expect(ok).toBe(false);
    expect(errors.join(" ")).toContain("needs a scope");
  }
});

test("the required set is exactly the types not hidden in the config", () => {
  expect(releasingTypes()).toEqual(["feat", "fix", "perf", "revert"]);
});

test("a type the config releases is a type the hook accepts", () => {
  // The two lists have different jobs — `TYPES` is the vocabulary, the config
  // is the release behaviour — but a type the config releases and the hook
  // rejects outright would be unusable, and nothing else would catch it.
  for (const type of releasingTypes() ?? []) {
    expect(TYPES).toContain(type);
  }
});

test("un-hiding a type in the config widens the requirement, with no edit here", () => {
  // The whole point of deriving the set. A test that only checked today's four
  // would pass against a hardcoded list and prove nothing.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commit-message-"));
  try {
    fs.writeFileSync(
      path.join(dir, "release-please-config.json"),
      JSON.stringify({
        "changelog-sections": [
          { type: "feat", section: "Features" },
          // The one change: `docs` loses its `hidden` flag.
          { type: "docs", section: "Documentation" },
          { type: "chore", section: "Chores", hidden: true },
        ],
      }),
    );

    const widened = releasingTypes(dir);
    expect(widened).toEqual(["feat", "docs"]);

    // `docs:` is accepted unscoped against the real config, three tests up.
    expect(check("docs: give every tool its own roadmap").ok).toBe(true);
    const { ok, errors } = validate("docs: give every tool its own roadmap", {
      scopes,
      releasingTypes: widened ?? [],
    });
    expect(ok).toBe(false);
    expect(errors.join(" ")).toContain("needs a scope");

    // And one that stayed hidden is still free.
    expect(validate("chore: pin the toolchain", { scopes, releasingTypes: widened ?? [] }).ok).toBe(
      true,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a breaking change needs a scope even when its type is hidden", () => {
  // A `hidden` type carrying `!` is not skipped — the BREAKING CHANGES heading
  // makes the changelog entry non-empty by itself, measured for repo-10 — so
  // deriving the rule from `hidden` alone would let this cut an unattributed
  // changelog line. Both spellings of breaking, and the non-breaking control.
  expect(check("chore: pin the toolchain").ok).toBe(true);

  const bang = check("chore!: drop the scripted provider");
  expect(bang.ok).toBe(false);
  expect(bang.errors.join(" ")).toContain("breaking change reaches a changelog");

  const footer = check(
    ["chore: rework the taxonomy", "", "BREAKING CHANGE: codes moved"].join("\n"),
  );
  expect(footer.ok).toBe(false);
  expect(footer.errors.join(" ")).toContain("breaking change reaches a changelog");
});

test("the scope requirement falls back rather than vanishing when the config is unreadable", () => {
  // `releasingTypes()` returns null outside the repo. Failing open entirely
  // would silently stop enforcing the rule; the fallback is the historical
  // minimum, which is unambiguous whatever the config says.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commit-message-"));
  try {
    expect(releasingTypes(dir)).toBe(null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  expect(validate("feat: add a thing", { scopes }).ok).toBe(false);
  expect(validate("fix: repair a thing", { scopes }).ok).toBe(false);
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

test("rejects a conventional line in a merge commit's body", () => {
  // The shape GitHub wrote while this repo landed pull requests as merge
  // commits. It cost downloader 0.2.0 a changelog with the same planner feature
  // listed twice, once for the branch commit and once for the merge that landed
  // it. Squash-only now, so this guards a `git merge --no-ff` done by hand.
  const { ok, errors } = check(
    [
      "Merge pull request #34 from brunolabbe/worktree-pl-16-the-plan-run",
      "",
      "feat(planner): run the fan-out as a job (pl-16)",
    ].join("\n"),
  );
  expect(ok).toBe(false);
  expect(errors.join(" ")).toContain("writes the changelog entry twice");
});

test("leaves a merge commit with prose or no body alone", () => {
  expect(check("Merge pull request #34 from brunolabbe/worktree-pl-16\n\n").ok).toBe(true);
  expect(
    check(
      [
        "Merge pull request #34 from brunolabbe/worktree-pl-16",
        "",
        "Takes the queue with it.",
      ].join("\n"),
    ).ok,
  ).toBe(true);
});

test("a revert's quoted subject is not read as a body line", () => {
  expect(
    check(
      [
        'Revert "feat(planner): scaffold a second tool"',
        "",
        "This reverts commit 1a2b3c4, which broke the planner's intake.",
      ].join("\n"),
    ).ok,
  ).toBe(true);
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

test("the title release-please gives a release pull request passes this rule", () => {
  // `pr-title.yml` checks every pull request, and a release PR is a pull
  // request. release-please's *default* title is `chore(main): release planner
  // 0.2.0` — the target branch sits where the scope goes, and `main` is not a
  // scope, so the release was gated by the gate. The pattern below is the fix,
  // and this test is what stops it being edited back into something the gate
  // rejects. Real scopes, read off `tools/`, so a third tool needs nothing here.
  const config: {
    "pull-request-title-pattern": string;
    packages: Record<string, { component: string; "component-no-space"?: boolean }>;
  } = JSON.parse(
    fs.readFileSync(new URL("../../release-please-config.json", import.meta.url), "utf8"),
  );

  for (const pkg of Object.values(config.packages)) {
    // Without this, release-please renders `${component}` with a leading space
    // and the title reads `chore( planner): release 0.2.0`.
    expect(pkg["component-no-space"]).toBe(true);

    const title = config["pull-request-title-pattern"]
      .replace("${scope}", "")
      .replace("${component}", pkg.component)
      .replace("${version}", "1.2.3")
      .trim();
    expect(validate(title)).toEqual({ ok: true, errors: [] });
  }
});

test("scope validation is skipped when the tool list cannot be read", () => {
  // `toolScopes()` returns [] outside the repo; an unknown scope must not then
  // block every commit on a bad guess about where it is running.
  expect(validate("feat(whatever): a thing", { scopes: [] }).ok).toBe(true);
});
