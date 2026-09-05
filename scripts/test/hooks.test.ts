import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * The two `PreToolUse` Bash hooks, exercised the way the harness runs them: a
 * JSON document on stdin, a verdict in the exit code.
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

interface HookRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** `shell: false` and an argv array, per the repo-wide rule. */
function run(hook: string, command: string): HookRun {
  const result = spawnSync("bash", [hook], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO },
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

test("both hooks are wired into the PreToolUse Bash matcher", () => {
  // Both run; neither replaces the other. A second matcher entry would work
  // equally well, so this asserts the commands are reachable under `Bash`
  // rather than the shape of the entry that carries them.
  const settings = JSON.parse(
    fs.readFileSync(path.join(REPO, ".claude", "settings.json"), "utf8"),
  ) as Settings;
  const commands = settings.hooks.PreToolUse.filter((entry) => entry.matcher === "Bash").flatMap(
    (entry) => entry.hooks.map((hook) => hook.command),
  );
  expect(commands.some((command) => command.endsWith("check-pr-title.sh"))).toBe(true);
  expect(commands.some((command) => command.endsWith("check-tree-grep.sh"))).toBe(true);
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

test("check-pr-title still reads a title out of a quoted span", () => {
  // The trap in the fix: strip for the boundary test only. Substitute the
  // stripped text into the extraction and the title becomes unfindable, turning
  // every real invocation into the rejection above.
  expect(isSilent(run(PR_TITLE, `${PHRASE} --title "feat(repo): x"`))).toBe(true);
});
