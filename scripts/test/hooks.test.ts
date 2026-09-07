import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * The `PreToolUse` Bash hooks, exercised the way the harness runs them: a JSON
 * document on stdin, a verdict in the exit code.
 *
 * They are shell, so nothing else here checks them — `npm run check` does not
 * read `.sh`, and until this file existed the only evidence either hook worked
 * was a command somebody had run once by hand. Both have now misfired live, on
 * a shape their author had not thought to try, which is the argument for
 * pinning the *shapes* rather than reviewing the regex. The shapes are
 * repo-22's acceptance list, moved here so they run on every push instead of
 * once.
 *
 * A hook that over-matches does not fail loudly. It blocks work in sessions
 * nobody is watching.
 */

const REPO = path.resolve(import.meta.dirname, "../..");
const TREE_GREP = path.join(REPO, ".claude", "hooks", "check-tree-grep.sh");
const PR_TITLE = path.join(REPO, ".claude", "hooks", "check-pr-title.sh");
const MAIN_WRITES = path.join(REPO, ".claude", "hooks", "check-main-writes.sh");

interface HookRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * `shell: false` and an argv array, per the repo-wide rule.
 *
 * `projectDir` is the checkout the hook sees as `CLAUDE_PROJECT_DIR`. It
 * defaults to this repo and is overridden only by `check-main-writes.sh`'s
 * bare-push cases, which read HEAD out of it: pointing those at the real
 * checkout would make the expected verdict depend on whichever branch the
 * suite happens to be running from, and CI runs it from `main`.
 */
function run(hook: string, command: string, projectDir: string = REPO): HookRun {
  const result = spawnSync("bash", [hook], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    shell: false,
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function isSilent({ status, stdout, stderr }: HookRun): boolean {
  return status === 0 && stdout === "" && stderr === "";
}

test("check-tree-grep warns on a tree-walking grep, and does not block it", () => {
  const result = run(TREE_GREP, "grep -rl x .");
  expect(result.stderr).toContain("command grep");
  expect(result.status).toBe(0);
});

test("check-tree-grep fires after a shell operator, not only at the start", () => {
  expect(run(TREE_GREP, "cd /tmp && grep -r x .").stderr).not.toBe("");
});

test("check-tree-grep finds -r inside a bundled short-flag cluster", () => {
  // Every real call site in this repo's tickets bundles it. A `-r\b` match
  // would pass a review and then fire on nothing.
  for (const command of [
    "grep -rl x .",
    "grep -lr x .",
    "grep -ril x .",
    "grep -R x .",
    "grep --recursive x .",
    "grep --include=*.ts -rl x .",
  ]) {
    expect(run(TREE_GREP, command).stderr, command).not.toBe("");
  }
});

test("check-tree-grep stays quiet on the spellings that are already correct", () => {
  // Each of these already runs the real binary, or does not walk a tree at all.
  // The wrapper is a bash function, so it only applies when `grep` is the
  // command word — which is what the boundary anchor is really testing for.
  for (const command of [
    "command grep -rl x .",
    "git grep -l x",
    "git grep -rl x",
    "grep -l x file.txt",
    'echo "grep -rl x ."',
    "cat f | grep -oE 'dl-[0-9]+'",
    "xargs grep -rl x",
  ]) {
    expect(isSilent(run(TREE_GREP, command)), command).toBe(true);
  }
});

test("check-tree-grep stays quiet on the paren-adjacent shape", () => {
  // The shape the naive boundary anchor got wrong: it read the raw `(` as a
  // command boundary without checking it was a shell operator rather than a
  // character inside a string. The quote-adjacent case above is the one that
  // anchor already handled, so it is not the one that proves anything.
  expect(isSilent(run(TREE_GREP, 'echo "(grep -r x .) is risky"'))).toBe(true);
});

test("check-tree-grep stays quiet when an escaped inner quote splits the phrase", () => {
  // The quote strip pairs `\"` as a real quote, so a naive strip deletes the
  // words *between* an operator and the phrase and manufactures an adjacency
  // the raw text never had. Removing backslash-escaped characters first is what
  // makes this silent. Advisory here, so the cost is noise — the same root
  // cause blocks a command in the sibling hook.
  expect(isSilent(run(TREE_GREP, 'printf "abc"; "she said \\"grep -r x .\\" too"'))).toBe(true);
});

test("check-tree-grep's header carries the reasoning, not a pointer to it", () => {
  // It is the only carrier: repo-22's decision was a hook and no prose
  // elsewhere, so a reader has nowhere else to look.
  const header = fs.readFileSync(TREE_GREP, "utf8");
  for (const fact of ["ignore-files", "command grep", "not exported"]) {
    expect(header, fact).toContain(fact);
  }
});

test("check-tree-grep cites its siblings rather than copying them", () => {
  const header = fs.readFileSync(TREE_GREP, "utf8");
  expect(header).toContain("repo-20");
  expect(header).toContain("records.md");
  // repo-20's own finding stays in repo-20. A fact kept in two places is the
  // defect repo-21 exists to remove, and this is the word that would give a
  // restatement away.
  expect(header).not.toContain("alternation");
});

interface Settings {
  readonly hooks: {
    readonly PreToolUse: readonly {
      readonly matcher: string;
      readonly hooks: readonly { readonly type: string; readonly command: string }[];
    }[];
  };
}

test("every hook is wired into the PreToolUse Bash matcher", () => {
  // All of them run; none replaces another. A second matcher entry would work
  // equally well, so this asserts the commands are reachable under `Bash`
  // rather than the shape of the entry that carries them.
  const settings = JSON.parse(
    fs.readFileSync(path.join(REPO, ".claude", "settings.json"), "utf8"),
  ) as Settings;
  const commands = settings.hooks.PreToolUse.filter((entry) => entry.matcher === "Bash").flatMap(
    (entry) => entry.hooks.map((hook) => hook.command),
  );
  for (const script of ["check-pr-title.sh", "check-tree-grep.sh", "check-main-writes.sh"]) {
    expect(
      commands.some((command) => command.endsWith(script)),
      script,
    ).toBe(true);
  }
});

/**
 * Split so the literal never appears in this file's own text. Spelled out, the
 * hook under test blocked the Bash call that was writing this file — the defect
 * demonstrating itself. Do not tidy it.
 */
const PHRASE = ["gh", "pr", "create"].join(" ");

test("check-pr-title ignores a command that only mentions the phrase in a quoted span", () => {
  // repo-22's reproduction, kept rather than described. Against the anchor as
  // it shipped, this exited 2 with the "without an inspectable --title"
  // rejection — measured before the fix. A stray `(` was the whole cause.
  const result = run(PR_TITLE, `printf 'see (${PHRASE} thing) for details'`);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

test("check-pr-title still rejects a title that is not a conventional commit", () => {
  // The half that proves the strip did not simply disable the guard. Strip too
  // much and this one passes.
  const result = run(PR_TITLE, `${PHRASE} --title 'nope'`);
  expect(result.stderr).toContain("not a conventional commit");
  expect(result.status).toBe(2);
});

test("check-pr-title still rejects an invocation with no inspectable title", () => {
  const result = run(PR_TITLE, `${PHRASE} --fill`);
  expect(result.stderr).toContain("inspectable --title");
  expect(result.status).toBe(2);
});

test("check-pr-title does not block when an escaped inner quote splits the phrase", () => {
  // A REGRESSION TEST, not an edge case. `origin/main` — which has no quote
  // strip at all — exits 0 on this input, because in the raw text the word
  // "note " sits between the `;` and the phrase and there is no adjacency to
  // match. Pairing `\"` as a real quote deletes "note" and manufactures one, so
  // the fix for the paren-adjacent hole opened a blocking hole of its own.
  const result = run(PR_TITLE, `x; "note \\"${PHRASE} abc\\" done"`);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

test("check-pr-title does not block a heredoc that quotes the phrase in prose", () => {
  // The shape that makes the one above matter: a real command word in front,
  // and a heredoc body that merely mentions the command. A heredoc misfire is
  // the reason this hook's boundary anchor exists at all — see its header — so
  // this is the case the strip had reopened. `origin/main` exits 0 here too.
  const command = `cat > /tmp/f.md <<'EOF'\n"run \\"${PHRASE} --web\\" to open it"\nEOF`;
  expect(isSilent(run(PR_TITLE, command))).toBe(true);
});

/**
 * The strip SUBSTITUTES one `\x01` per removed span rather than deleting it,
 * because a deletion moves its neighbours together and can build an adjacency
 * the raw text never had. Two shipped false blocks came from that one
 * mechanism. These are the shapes that break a *deleting* strip — chosen by
 * attacking the fix, not by replaying the bugs it cured, which is the rule this
 * ticket earned. Against the deleting version three of them fail; only one had
 * ever been found by hand.
 */
const SENTINEL = "";

test("check-pr-title does not block when an escape precedes the phrase", () => {
  for (const gap of ["\\x", "\\\\", "\\;", 'a\\"b']) {
    const command = `true; ${gap} ${PHRASE} --web`;
    // `\x` is a no-op escape, so this runs a program named `x` — it never
    // invokes the guarded command at all. origin/main is silent on `\x` and
    // `\\`; on `\;` it blocks, for its own reasons — see below.
    expect(isSilent(run(PR_TITLE, command)), command).toBe(true);
  }

  // Not evidence for the substitution — a deleting strip passes this too. It
  // pins a defect this branch fixes in passing: `\;` escapes the semicolon, so
  // this passes `;` as a literal argument to `true` and never invokes the
  // guarded command, yet origin/main's escape-blind anchor blocks it. Isolated
  // by the repo-22 gate when it refused to reproduce a count taken on trust.
  expect(isSilent(run(PR_TITLE, `true \\; ${PHRASE} --web`))).toBe(true);
});

test("check-pr-title does not forge a boundary out of one inside a quoted span", () => {
  // A `;`, `&&` or `(` that exists only inside a string is not a shell
  // operator. Deleting the span could leave the phrase against whatever
  // preceded it; substituting cannot.
  for (const span of ['"a;b"', '"a&&b"', '"a(b"']) {
    const command = `foo ${span} ${PHRASE} --web`;
    expect(isSilent(run(PR_TITLE, command)), command).toBe(true);
  }
});

test("check-pr-title treats a literal sentinel in the command as inert", () => {
  // The sentinel need not be absent from real input: it is not whitespace, not
  // a boundary character and not part of the phrase, so one that someone
  // actually types can neither forge a match nor break a real one.
  expect(isSilent(run(PR_TITLE, `echo "a${SENTINEL}b"`))).toBe(true);
  expect(run(PR_TITLE, `${PHRASE} --title 'nope'${SENTINEL}`).status).toBe(2);
});

test("check-tree-grep does not warn when an escape precedes the command word", () => {
  // Same substitution, same reasoning; advisory here, so the cost of the bug
  // was noise rather than a block.
  expect(isSilent(run(TREE_GREP, "true; \\x grep -rl x ."))).toBe(true);
});

test("check-pr-title still reads a title out of a quoted span", () => {
  // The trap in the fix: strip for the boundary test only. Substitute the
  // stripped text into the extraction and the title becomes unfindable, turning
  // every real invocation into the rejection above.
  expect(isSilent(run(PR_TITLE, `${PHRASE} --title "feat(repo): x"`))).toBe(true);
});

/**
 * check-main-writes.sh — repo-15 tier 1, decision A1.
 *
 * The threats it is answerable for are the ones the deny list's globs miss, so
 * the cases below are the deny list's gaps rather than a re-test of what
 * `.claude/settings.json` already refuses. Measured against that file at build
 * time, `Bash(git push * main*)` and `Bash(git push *:main*)` need a literal
 * " main" or ":main", so `+main`, `refs/heads/main` and a bare `git push` all
 * slip them; `Bash(gh pr merge *)` needs an argument, so a bare `gh pr merge`
 * slips it too.
 *
 * The allowed cases are not filler. A hook that wrongly blocks trains everyone
 * to route around it, and routing around it works — so every blocked shape here
 * is paired with the nearest shape that must stay silent.
 */

/** Split for the same reason `PHRASE` is: so the literal never sits at the */
/** start of a line in this file, where the hook under test would read it as an */
/** invocation if anything ever rewrote this file through a heredoc. */
const MERGE = ["gh", "pr", "merge"].join(" ");
const PUSH = ["git", "push"].join(" ");

/** A checkout whose HEAD is a known branch. No commit is needed: */
/** `git symbolic-ref` answers on an unborn branch, which is what the hook reads. */
function checkoutOn(branch: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "main-writes-")));
  const init = spawnSync("git", ["init", "-b", branch, dir], { encoding: "utf8", shell: false });
  expect(init.status, init.stderr).toBe(0);
  return dir;
}

test("check-main-writes refuses a pull request merge, including the bare form", () => {
  // Bare is the one that matters: `Bash(gh pr merge *)` is an anchored prefix
  // with a trailing `*`, and `gh pr merge` with no argument opens an
  // interactive picker. Whether the real matcher covers it was not settled —
  // see the hook's header — so the hook covers it either way.
  for (const command of [
    `${MERGE} 129 --squash`,
    `${MERGE} 129 --auto --squash`,
    MERGE,
    `${MERGE} --repo owner/other 7`,
    `cd /tmp && ${MERGE} 129`,
  ]) {
    const result = run(MAIN_WRITES, command);
    expect(result.status, command).toBe(2);
    expect(result.stderr, command).toContain("owner's decision");
  }
});

test("check-main-writes refuses every spelling of main the deny list's globs miss", () => {
  for (const command of [
    `${PUSH} origin +main`,
    `${PUSH} origin refs/heads/main`,
    `${PUSH} origin +refs/heads/main`,
    `${PUSH} origin HEAD:refs/heads/main`,
    // Already denied by a permission rule; here as the second layer, because
    // the deny list is a file the agent it constrains can edit.
    `${PUSH} origin main`,
    `${PUSH} --force origin main`,
    `${PUSH} origin HEAD:main`,
    `${PUSH} origin :main`,
  ]) {
    const result = run(MAIN_WRITES, command);
    expect(result.status, command).toBe(2);
    expect(result.stderr, command).toContain("explicit refspec targeting main");
  }
});

test("check-main-writes reads HEAD for a push with no refspec, rather than guessing", () => {
  // The command string cannot say where a bare push lands, so the hook asks the
  // checkout. One positional counts as none: `git push origin` still leaves the
  // branch implicit.
  const onMain = checkoutOn("main");
  for (const command of [PUSH, `${PUSH} origin`, `${PUSH} --force`, `${PUSH} -u origin`]) {
    const result = run(MAIN_WRITES, command, onMain);
    expect(result.status, command).toBe(2);
    expect(result.stderr, command).toContain("HEAD is main");
  }
});

test("check-main-writes leaves a bare push alone when HEAD is not main", () => {
  // The other half of the branch read. Without it the hook would refuse the
  // ordinary push every builder here makes, which is the failure mode that
  // teaches people to route around a hook.
  const onFeature = checkoutOn("repo-15-fixture");
  for (const command of [PUSH, `${PUSH} origin`, `${PUSH} -u origin`]) {
    expect(isSilent(run(MAIN_WRITES, command, onFeature)), command).toBe(true);
  }
});

test("check-main-writes leaves an ordinary branch push alone", () => {
  for (const command of [
    `${PUSH} -u origin repo-15-deny-list-hook`,
    `${PUSH} --force origin my-feature`,
    `${PUSH} origin HEAD:my-feature`,
    // A near miss on the destination test. `main-thing` is not `main`, and a
    // substring check would refuse it.
    `${PUSH} origin main-thing`,
    `${PUSH} origin mainline`,
    `${PUSH} origin feature:feature`,
    `${PUSH} origin --delete my-feature`,
  ]) {
    expect(isSilent(run(MAIN_WRITES, command)), command).toBe(true);
  }
});

test("check-main-writes reads each invocation's own arguments, not the whole line", () => {
  // `main` after `&&` belongs to the echo. Matching across the operator would
  // block a correct push because of a word in an unrelated command.
  expect(isSilent(run(MAIN_WRITES, `${PUSH} origin my-feature && echo main`))).toBe(true);
  expect(isSilent(run(MAIN_WRITES, `echo main; ${PUSH} origin my-feature`))).toBe(true);
  // And the reverse: a real one after an operator is still found.
  expect(run(MAIN_WRITES, `echo hi && ${PUSH} origin +main`).status).toBe(2);
});

test("check-main-writes ignores a command that only mentions the phrase in prose", () => {
  // Build step 3's case, and it is not hypothetical: repo-15's own ticket file
  // contains every dangerous string here as prose, so a substring test blocks
  // reading the ticket back. check-pr-title.sh's first live run was exactly
  // this failure, against a heredoc.
  for (const command of [
    `echo "${MERGE} 129 --squash"`,
    `echo "(${MERGE} 129) is denied"`,
    `grep -n "${PUSH} origin main" docs/work/repo-15-deny-list-does-not-protect-itself.md`,
    `x; "note \\"${MERGE} 129\\" done"`,
    `printf 'see (${PUSH} origin +main) for details'`,
  ]) {
    expect(isSilent(run(MAIN_WRITES, command)), command).toBe(true);
  }
});

test("check-main-writes does not block a heredoc that quotes the phrases in prose", () => {
  const command = `cat > /tmp/f.md <<'EOF'\n"run \\"${MERGE} 129\\" to land it"\n"or \\"${PUSH} origin +main\\", which is refused"\nEOF`;
  expect(isSilent(run(MAIN_WRITES, command))).toBe(true);
});

test("check-main-writes over-blocks an unquoted heredoc line, and that is pinned", () => {
  // NOT an assertion that this is right. It pins the one shape where the hook
  // refuses something harmless, so the trade is met here rather than in a
  // refusal nobody expected. The boundary rule works per line, so an *unquoted*
  // mention at the start of a heredoc body line is indistinguishable from an
  // invocation; check-pr-title.sh has had the identical shape since it shipped.
  // Quoting the mention makes it silent, which the case above already proves.
  const fenced = `cat > /tmp/f.md <<'EOF'\n    ${PUSH} origin +main\nEOF`;
  expect(run(MAIN_WRITES, fenced).status).toBe(2);
  // The reason it costs little: the shapes a document actually contains are
  // either quoted or harmless.
  expect(
    isSilent(run(MAIN_WRITES, `cat > /tmp/f.md <<'EOF'\n${PUSH} -u origin <branch>\nEOF`)),
  ).toBe(true);
});

test("check-main-writes misses a quoted refspec, which is the direction to miss in", () => {
  // Also pinned rather than claimed. The quote strip replaces a quoted span
  // before the argument scan runs, so these are invisible to it. Both are
  // refused by the ruleset on `main` regardless, and over-blocking is the
  // costlier error — see the hook's header.
  expect(isSilent(run(MAIN_WRITES, `${PUSH} origin "main"`))).toBe(true);
  expect(isSilent(run(MAIN_WRITES, `${PUSH} origin '+main'`))).toBe(true);
});

test("check-main-writes does not expand a glob while tokenising", () => {
  // The argument scan word-splits, which is also globbing unless it is turned
  // off. With globbing on, `*` becomes the hook's own working directory
  // listing — and this repo's root contains no `main`, so the bug would hide
  // here and surface somewhere else.
  expect(isSilent(run(MAIN_WRITES, `${PUSH} origin *`))).toBe(true);
});

test("check-main-writes stays out of the way of commands that cannot push", () => {
  const onMain = checkoutOn("main");
  for (const command of [`${PUSH} --dry-run origin main`, `${PUSH} --help`, `${PUSH} -n`]) {
    expect(isSilent(run(MAIN_WRITES, command, onMain)), command).toBe(true);
  }
  for (const command of ["gh pr list --state open", "gh pr view 129", "git status"]) {
    expect(isSilent(run(MAIN_WRITES, command)), command).toBe(true);
  }
});

test("check-main-writes says what to do instead, rather than only refusing", () => {
  // Both existing hooks do this, and the reason is in repo-15: a hook that says
  // "denied" trains the reader to route around it, and routing around it works.
  expect(run(MAIN_WRITES, `${MERGE} 129`).stderr).toContain("ask for the merge");
  expect(run(MAIN_WRITES, `${PUSH} origin +main`).stderr).toContain("open a pull request");
});

test("check-main-writes carries its limits in its header, not only in the ticket", () => {
  // repo-15 `Done when` 5. The header is the only place the next editor
  // reliably reads, and each of these is a fact that makes the hook look
  // stronger than it is if it is missing.
  const header = fs.readFileSync(MAIN_WRITES, "utf8");
  for (const fact of [
    // the ruleset requires a pull request and then requires nobody on it
    "required_approving_review_count: 0",
    // indirection defeats a hook that reads a command string
    "base64 -d",
    // it cannot protect itself, and repo-15 §1 stays uncovered under A1
    "unregister this hook",
    // `gh api` is untouched on purpose — decision B1, not an oversight
    "decision B1",
  ]) {
    expect(header, fact).toContain(fact);
  }
});
