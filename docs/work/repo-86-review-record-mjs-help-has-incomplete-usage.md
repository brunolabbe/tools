---
id: repo-86
tool: repo
title: review-record.mjs --help prints only the first usage line
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-86 — review-record.mjs --help prints only the first usage line

## Why

`scripts/review-record.mjs --help` is not a recognised option: it prints
`unknown option --help`, only the first of the script's three usage lines, and
exits 1. The other two are not printed anywhere a caller can reach without
reading the source: `--verify` at
`scripts/review-record.mjs@b658179:597 "--verify <ticket-file> <section-file>"`
and `--land` at
`scripts/review-record.mjs@b658179:921 "--land <ticket-file>"`. Three landing
fixers in the 2026-09-30 batch needed `--verify`/`--rev` and did not find it in
the output.

**Reproduction** (run from the repository root at `b658179`):

```
$ node scripts/review-record.mjs --help; echo "exit=$?"
unknown option --help
usage: node scripts/review-record.mjs <ticket-file> <section-file> [--gate <n>]
exit=1
```

## Build

Make `scripts/review-record.mjs` print all three usage lines when it is given
`--help`. The real lines, as the script has them, are:

```
usage: node scripts/review-record.mjs <ticket-file> <section-file> [--gate <n>]
usage: node scripts/review-record.mjs --verify <ticket-file> <section-file> [--gate <n>] [--rev <rev>]
usage: node scripts/review-record.mjs --land <ticket-file> <section-file>... --base <ref> --status done|in-flight --title "<title>"
```

**Open choice for the builder to settle in the Log:** whether `--help` should
exit 0 (a requested help text is not a failure) or keep exit 1, as the unknown
option does today. Not decided here.

## Done when

- `node scripts/review-record.mjs --help` prints all three usage lines.
- `npm run check` passes.

## Review

### Gate 1

**Gate: PASS** — 2026-10-03 · `ebb808b...d787b32` (head `d787b32`; `origin/main` still at `ebb808b` after the gate fetched) · code-review at medium

| Done when                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/review-record.mjs --help` prints all three usage lines                        | **verified** — nothing asserts it, see F1. Run at the head: exit 0, three lines on stdout, nothing on stderr. Run at the base (`scripts/` extracted from `ebb808b`, `node_modules` linked): exit 1, nothing on stdout, stderr `unknown option --help` and the first usage line only. Second method, by grep: `grep -F -x` of each printed line against the source finds exactly the three usage constants, `scripts/review-record.mjs@ebb808b:83 "usage: node scripts/review-record.mjs <ticket-file>"`, `scripts/review-record.mjs@ebb808b:598 "usage: node scripts/review-record.mjs --verify <ticket-file>"` and `scripts/review-record.mjs@ebb808b:922 "usage: node scripts/review-record.mjs --land <ticket-file>"`, and `grep -c usage:` finds no fourth. The branch prints them at `scripts/review-record.mjs:1557 "${VERIFY_USAGE}\n${LAND_USAGE}"` ✓ |
| `npm run check` passes                                                                      | **verified** — exit 0 at `d787b32`, after `npm run build` (exit 0) on the detached head, read from a run redirected to a file rather than through a pipe. `scripts/preflight.mjs --base origin/main --title "fix(repo): print every usage line for review-record.mjs --help (repo-86)"` also exits 0, its own steps `npm run check` and `npm test -- --project repo` both ok ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| The brief open choice, exit 0 or 1, settled in the Log with a reason (not a Done-when line) | **verified** — the Log entry dated 2026-10-03 chooses 0 and gives the reason, a requested help text is not a failure. No caller depends on the old status: 38 tracked files name review-record, and outside the script, its test and ticket or skill prose no script, workflow, hook or package.json script invokes it. The only line naming it with `--help` besides this branch is the defect row `.claude/skills/orchestrate-tickets/reference/history.md@ebb808b:4439 "is an unknown option, and its main usage line omits"`, and the test file never passes `--help` ✓                                                                                                                                                                                                                                                                                   |

- **low** · F1 — nothing tests `--help`, and the suite stays green with the whole fix reverted. The test file already spawns the CLI once per mode through `scripts/test/review-record.test.ts@ebb808b:267 "function runCli(dir: string"`, and no line in it passes `--help`. Reproduction: `git checkout ebb808b -- scripts/review-record.mjs` over the head, then `npx vitest run scripts/test/review-record.test.ts` — 68 passed of 68, exit 0, with `grep -c` finding no `--help` branch in the file; restored afterwards, tree clean. So the next edit to the entry point goes unseen, and so does a fourth mode that gains its own usage constant and is not appended to the hand-listed triple at `scripts/review-record.mjs:1557 "${VERIFY_USAGE}\n${LAND_USAGE}"`, which is how this defect arose. The Log says "Tests pass", which reads as coverage and is not. Below the floor: the row above is verified by re-run, nothing is wrong today, and the branch is one conditional. Remedy, not required here: one test through `runCli(dir, ["--help"])` asserting status 0 and the three exported constants on stdout, as repo-14 did for its own usage line, `docs/work/repo-14-citations-section-flag-is-a-no-op.md@ebb808b:158 "nothing tied the docblock usage line"`.
- **low** · F2 — `--help` is found with `argv.includes`, so any element equal to `--help`, in any position and any mode, prints help and exits 0 before `--land` or `--verify` run. Enumerated over 12 invocations at the base and again at the head. Error at the base, help at the head: `--verify --help`, `--land --help`, `t.md s.md --help`, `--help t.md s.md`, `t.md s.md --gate --help` (a bad `--gate` value at the base) and `--verify t.md s.md --rev --help` (`--rev needs a value` at the base). Identical at both: `t.md ./--help`, `-h`, `--helpx`, no arguments, `--verify` alone. One invocation that parsed at the base now changes meaning: `--land` with `--help` as the value of `--base` or `--title`, which `parseLandArgs` takes whole (`scripts/review-record.mjs@ebb808b:951 "else title = value;"`; measured through the exported function at the base, title `--help` and base `--help` both returned) and which at the head prints help, exits 0 and does not land. Neither is a genuine invocation: `node scripts/commit-message.mjs --text "--help"` exits 1 as not a conventional commit, `--land` hands the title to preflight at `scripts/review-record.mjs@ebb808b:1243 "runPreflightDefault(repo, base, title, spawn = spawnSync)"`, and a branch name cannot start with `-`. A section file literally named `--help` was never passable bare, since a leading `-` is an unknown option in all three parsers, and `./--help` is a different token. So no genuine invocation now short-circuits to help. Disclosed because the guard reads the whole argv where the parsers consume values, and because `-h` stays an unknown option, the brief having named only `--help`.
- **dropped** · the redundant `process.exitCode = 0` in the new branch: a no-op, since 0 is the default, and harmless — it states the Log exit choice in code. Not a defect.
- **findings** · code-review at medium, run by hand with no finder agents, raised 3 candidates; 2 carried (F1, F2), 1 dropped.
- Invariants: style ✓ (output through `process.stdout.write`, no `console`, no `any`); the rest skipped, since the diff touches no tool, contract, error code, spawn, URL or `Dockerfile`.
- NFR: security n/a — one string comparison on argv, no shell · performance n/a · reliability ✓ — a requested help text goes to stdout with exit 0; F2 · maintainability — F1, a hand-listed triple with nothing tying it to the modes.

## Log

- 2026-09-30 — Filed from landing fixer reports, reproduced at b658179.
  Three fixers on 2026-09-30 reported needing `--verify`/`--rev` without
  finding them in the usage line printed by `--help`.
- 2026-10-03 — Fixed by adding --help handling to the entry point. Added a check for `argv.includes("--help")` before the routing to `landMain`/`verifyMain`/`main`, which prints all three usage lines and exits with code 0. Exit code choice: 0 (success). Rationale: a requested help text is not a failure, and Unix convention is to exit 0 when --help is requested. Tests pass, preflight passes.
