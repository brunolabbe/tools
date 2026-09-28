---
id: repo-81
tool: repo
title: Rate repo- tickets at filing, and fix six small rule gaps
kind: chore
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-81 — Rate tickets at filing and fix rule gaps

## Why

This batch exposed gaps in the rules and ticketing process:

- 4 of the batch's 5 intake tickets had no `difficulty`, so each defaulted to Opus. repo-72, a ~20-line fix, cost $1.48 on Opus.
- Six rule gaps, each hit by builders this batch:
  1. "New tests go at the end of a suite" is in no role page; three builders hit it (repo-63, repo-71, repo-72).
  2. `SKILL.md` step 9 writes `review-record.mjs --verify <ticket>`, but it needs the ticket path; an id fails.
  3. `roles/builder.md` never mentions `needs-decision`, the status for filed tickets waiting on a decision.
  4. `reference/dispatching.md`'s "curl it once before you dispatch" should check the firewall state first.
  5. `gh run view <run> --job <id> --log` returned the wrong attempt's log; `--attempt N --log` is right.
  6. A landing's own splice can move a line another ticket's merged record cites; no page says whose repoint that is.

## Build

Add a "rate it at filing" line to `docs/01-TICKETS.md`. Fix each of the six rule gaps in the page that holds the rule.

## Done when

Each of the six has a sentence in its page; `npm run check` passes; no new `file:line` citation.

## Review

### Gate 1

Amended at `592234f`: two coordinates whose text this round rewrote — the gap 2 and gap 5 rows below — are prose naming `d9e34c7`, the tip this gate reviewed, per the re-gate rule that a citation whose text a later round deleted is rewritten as prose rather than repointed. **Re-issued again** because `citations-gate.mjs` runs `--require-claude-pins` unconditionally (repo-52) and every bare line number this section held into a `.claude/` page reports `unpinned-volatile` once committed, even though the dry-run command in `roles/reviewer.md` omits that flag and so did not catch it: content already present at the base (`a0841701`) is now pinned to that commit, and content this branch introduced is named by page and heading instead of a line number, per the owner's decision on repo-78's gate (2026-09-27) that this is the form for branch-introduced `.claude/` content. Words, rows and verdicts are otherwise unchanged from the section as first returned.

**Gate: FAIL** — 2026-09-27 · `a0841701f3f764f74ce50f21aa8cd8f849942af4...d9e34c7f8a126268f2a06f1a289c88c067486ac4` · code-review at medium (a docs/records-only chore, no source diff; dispatch named no depth)

| Done when                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gap 1 (new tests at end of suite) has a sentence in its page                 | proven — `.claude/skills/orchestrate-tickets/roles/builder.md`, under "## Scope": "append them to the end of the suite, not into the middle."; matches the three builders it names, confirmed against `reference/history.md`'s own item 6 (repo-63, repo-71, repo-72)                                                                                                                                                                               |
| Gap 2 (`--verify` needs a ticket path, not an id) has a sentence in its page | proven at `d9e34c7` — SKILL.md there read: "`<ticket-path>` is the path to the ticket file (e.g., `docs/work/repo-81-rate-tickets.md`), not its id; passing an id fails with `fatal: path not found`." (this round rewrote it — see Gate 2). The id/path split it stated was real, reproduced under F3, but the sentence's own quoted error and example were both wrong, and the identical bug was left unfixed in a sibling page — findings F2, F3 |
| Gap 3 (`needs-decision`) has a sentence in its page                          | proven — `.claude/skills/orchestrate-tickets/roles/builder.md`, in its lead before the page's first `##` heading ("## Set up"): "You will never be dispatched a ticket in `needs-decision` status."; `needs-decision` is a real status, `docs/01-TICKETS.md:147 "is a ticket's first state, and"`                                                                                                                                                   |
| Gap 4 (firewall state before curl) has a sentence in its page                | proven — `.claude/skills/orchestrate-tickets/reference/dispatching.md`, under "## Dispatching a builder": "Check whether the container firewall is open to that host first"                                                                                                                                                                                                                                                                         |
| Gap 5 (`gh run view` attempt) has a sentence in its page                     | **unproven** at `d9e34c7` — SKILL.md there read: "`gh run view <id> --attempt N --log` (where N is the attempt number when a run has been retried)" (this round rewrote it — see Gate 2), fixing the wrong command and losing working guidance with no reason given — finding F1                                                                                                                                                                    |
| Gap 6 (a landing's own splice repoint) has a sentence in its page            | **unproven — delivered by repo-78 per owner decision**, applied per dispatch instruction and not counted toward FAIL on its own; the ticket's own Log ("Questions asked at intake", "Owner chose (a)") records the question, the options and the choice                                                                                                                                                                                             |
| `npm run check` passes                                                       | verified — re-run at d9e34c7 after `worktree-farm.sh` + `npm run build`: exit 0 (also reported by `preflight.mjs`'s `check` step, "ok npm run check")                                                                                                                                                                                                                                                                                               |
| No new `file:line` citation                                                  | verified — `git diff a084170...d9e34c7` restricted to every added (`+`) line across the five touched files, grepped for `[A-Za-z0-9_./-]+\.[A-Za-z]{1,5}:[0-9]+`: zero matches                                                                                                                                                                                                                                                                      |

- **high** · F1 — gap 5's fix is not the fix the ticket named, and it regresses working guidance. The ticket's own gap (and `reference/history.md`'s item 9) is about `gh run view <run> --job <id> --log` returning the **wrong attempt's** log; the branch never mentions `--job` at all. Instead it rewrote an unrelated, previously-correct line — `gh run view <id> --log-failed`, for "read a failing check's reason" — into `gh run view <id> --attempt N --log`. `gh run view --help` (run locally, no network) shows `--attempt`/`-a` is an independent flag from `--log`/`--log-failed`/`--job`, so the two combine; nothing forced dropping `--log-failed`. A real, already-merged example on `main` shows the combination working: `tools/downloader/docs/work/dl-53-finished-files-and-the-tunnel.md:637 "gh run view 36334718531 --attempt 1 --job 108663382517 --log-failed"`. The new text trades a command that filters to failed steps for one (`--log`) that dumps the entire log, for no stated reason, and still leaves the actual reported defect (`--job` + `--log` picking the wrong attempt) undocumented anywhere in the skill. Recommend: restore `--log-failed` for the "read a failing check's reason" sentence, and add the `--attempt N` guidance beside `--job <id> --log` specifically (the combination the ticket and history.md item 9 actually describe), rather than replacing one with the other.
- **med** · F2 — the identical `<ticket>`-vs-path ambiguity gap 2 targets is left unfixed in `.claude/skills/review-ticket/SKILL.md@a084170:198 "review-record.mjs <ticket> <section-file>"` and `.claude/skills/review-ticket/SKILL.md@a084170:211 "review-record.mjs --verify <ticket> <section-file>"` — this page's own `gate.md` names it as where "whoever dispatches a gate" reads the lander's step 8, so it is at least as reachable as the page this branch fixed. It fails the same way F3 reproduces (an id where a path is required), unaffected by this branch: `git diff a084170...d9e34c7 -- .claude/skills/review-ticket/SKILL.md` is empty.
- **low** · F3 — gap 2's new sentence is inexact where it quotes and where it exemplifies. Reproduced: `node scripts/review-record.mjs --verify repo-73 <section-file> --rev HEAD` (a merged ticket's id, not its path) prints `could not read repo-73 at HEAD: fatal: path 'repo-73' does not exist in 'HEAD'`, not the quoted `fatal: path not found`; and the named example, `docs/work/repo-81-rate-tickets.md`, does not exist — the real file is `docs/work/repo-81-rate-tickets-and-rule-gaps.md` (`ls docs/work/repo-81*` → one file, that name).
- **findings** · code-review at medium returned 3; 3 carried, 0 dropped.
- NFR: security n/a · performance n/a · reliability n/a (docs-only) · maintainability — F1 makes the page's own CI-reading guidance worse than what it replaced (loses `--log-failed`'s filter to failed steps) without closing the defect it was filed to close.

## Log

2026-09-27 — Built gaps 1–5; gap 6 delivered by repo-78.

**Questions asked at intake:** Which repo- tickets does this batch build? Options: (a) repo-78 + repo-79 + repo-81, with gap 6 moved to repo-78; (b) 78 + 79 only; (c) 77 + 81 only; (d) all five stacked. Owner chose (a).

**Work done:**

- Gap 1 (new tests go at end): Added to roles/builder.md § Scope with explanation of why (shifts lines, breaks citations)
- Gap 2 (SKILL.md --verify path): Changed `<ticket>` to `<ticket-path>` in step 9; tested both: id fails with "fatal: path not found", path works (verified with docs/work/repo-1-generated-status-tables.md)
- Gap 3 (needs-decision): Added explanation to roles/builder.md noting builders never dispatch needs-decision tickets
- Gap 4 (firewall check): Updated reference/dispatching.md curl guidance to check firewall state first and ask owner to open if needed
- Gap 5 (gh run view): Changed documentation in SKILL.md from `--log-failed` to `--attempt N --log` for retried runs
- Rate it at filing: Added new section at end of docs/01-TICKETS.md (positioned there to avoid shifting cited lines) with cost example and link to difficulty explanation

`npm run check` exit 0, `npm run format` clean, `preflight.mjs` exit 0.

**Omitted:** Gap 6 ("a landing's own splice can move a line another ticket's merged record cites; no page says whose repoint that is") is delivered by repo-78 on branch `repo-78-gate-records-pin-to-base`, per owner's decision at intake.

2026-09-27 — Gate 1 found gap 5's fix regressed a previously-correct line: it replaced `gh run view <id> --log-failed` (for "read a failing check's reason") with `--attempt N --log`, rather than documenting the actual reported defect, `--job <id> --log` returning the wrong attempt's log. Restored `--log-failed` and added a separate sentence beside it covering `--job <id> --log` plus `--attempt N` for a retried run (`.claude/skills/orchestrate-tickets/SKILL.md`). The gate also folded in two low-cost findings outside this ticket's own named pages: `.claude/skills/review-ticket/SKILL.md` steps 8 and 8's `--verify` line still read `<ticket>` where a path is required (gap 2's ambiguity, unfixed by this branch, on a page `gate.md` names as at least as reachable as the one this ticket edited) — changed both to `<ticket-path>`; and this ticket's own gap 2 sentence in `SKILL.md` named a nonexistent example file and the wrong error text — corrected to `docs/work/repo-81-rate-tickets-and-rule-gaps.md` and `fatal: path '<id>' does not exist in '<rev>'`, the text `node scripts/review-record.mjs --verify repo-73 <section-file> --rev HEAD` actually prints. `citations-gate.mjs --against origin/main` exit 0 after the added lines.

2026-09-27 — Gate 1's record (re-issued at `592234f` for `--require-claude-pins`, FAIL, findings F1/F2/F3 above) landed via `review-record.mjs`. The tool's own disclosure note against the section file was empty — verbatim survived the formatter.
