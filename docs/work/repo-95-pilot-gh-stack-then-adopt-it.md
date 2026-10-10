---
id: repo-95
tool: repo
title: Pilot the `gh stack` extension on the next chain, then adopt it for stacked branches
kind: chore
status: in-flight
milestone: null
depends_on: []
difficulty: hard
---

# repo-95 — Pilot `gh stack` on the next chain, then adopt it

## Why

On 2026-10-06 the owner reversed part of [repo-48](./repo-48-should-this-repo-adopt-a-stacked-branch-tool.md),
which chose process only ("Option 1": cut B from A, open it as a draft against
A) plus one pilot of GitHub's native stacks through the website, and ruled out
the `github/gh-stack` extension. **The decision now: pilot with the extension,
and adopt it if the pilot holds.** That was the recommended option. The others
were adopting it outright, and keeping Option 1 with the website pilot.

The case comes from tools-79's batch (dl-78 to dl-83, 2026-10-06). That batch
stacked five pull requests by hand, every one based on `main`. Measured from
`gh pr view <n> --json mergedAt` and the session's own board:

| PR   | Ticket | Merged (UTC)   |
| ---- | ------ | -------------- |
| #371 | dl-78  | 10-06 03:19    |
| #373 | dl-79  | 10-06 03:41    |
| #370 | dl-82  | 10-06 12:39    |
| #372 | dl-80  | 10-06 23:11    |
| #374 | dl-83  | open at filing |

After each merge the orchestrator merged `main` into the next branch, cleared
the artificial conflicts the squash creates, read CI again (around 15 minutes)
and only then marked the next PR ready. That is one owner round trip per PR.
On #370 the step also needed a repair: a Haiku builder's merge came out broken,
and a second fixer had to prove the merged test file by content. A native stack is merged once from its top. That merges every
PR below it, one squash commit each, and GitHub rebases what is left itself.

**What a stack does not fix**, so nobody adopts it expecting this: the
overnight stall in the same batch (04:49 to 12:10) waited on a decision, not
on a merge. dl-80's 9 s floor pushed one of dl-83's tests to 23.3 s against a
25 s budget. [repo-96](./repo-96-an-away-owner-does-not-stall-a-reversible-choice.md)
covers that. Merging also stays the owner's: `gh stack merge` merges, and the
existing `Bash(gh pr merge *)` deny does not match it.

## Build

1. **Guard before install.** Add `Bash(gh stack merge*)` to the `deny` list
   in `.claude/settings.json`. Confirm it binds by running `gh stack merge
--help` and watching it be refused. This step happens first, before
   anything can merge.
2. **Install, durably.** `gh extension install github/gh-stack`, pinned to a
   release tag (v0.1.1 was current at repo-48). Add the same pinned install to
   `.devcontainer/Dockerfile`, and add `release-assets.githubusercontent.com`
   to `.devcontainer/allowed-domains.txt`. At filing that host answered
   (`curl` got an HTTP 404 back) only because the firewall was down, and it is
   not in the allowlist. A rebuild picks up the allowlist; re-running
   `init-firewall.sh` does not. The owner does the rebuild.
3. **Run the pilot on the next real chain**, meaning two batch branches the
   seam map says must share a file. Do not build a synthetic one. Record in
   this ticket's Log, each with the command and its output:
   - whether a stack exists on this personal repository at all (`gh stack
link <A> <B>`, then `gh pr view <B> --json baseRefName`);
   - **linear history.** Builders currently `git merge origin/main` into
     their branches, and tools-79 chose merge over rebase on purpose so no
     gated commit was force-pushed. Does a merged-in `main` block the stack's
     merge? If it does, the builder roles switch to rebase plus force-push,
     and gate records must then name the rebased sha;
   - **a live worktree.** After a server-side "Rebase stack", or the automatic
     rebase that follows a bottom merge, what does a builder whose worktree
     still holds the old branch see on its next push? Write down the recovery
     command;
   - whether a squash-merged stack still gives one changelog line per ticket
     (release-please reads squash subjects, so check each squash subject
     against `scripts/commit-message.mjs`).
4. **Adopt, or stop.** If all four hold, rewrite the "stack them on purpose,
   as a draft" procedure in
   `.claude/skills/orchestrate-tickets/reference/concurrency.md` around
   `gh stack`, and delete the website-pilot paragraph. Update the builder and
   fixer role pages wherever they say to merge `main` in. If any point fails,
   leave Option 1 standing. Remove the extension, its allowlist entry and its
   `Dockerfile` line, keep the deny rule, and record why here. Either way, add
   a Log line to repo-48 pointing here.

## Done when

1. `gh stack merge` is refused by a deny rule in `.claude/settings.json`,
   shown by the refusal.
2. The extension is installed at a pinned tag by `.devcontainer/Dockerfile`,
   and its download host is in `.devcontainer/allowed-domains.txt`. Or, if the
   pilot failed, neither is.
3. This ticket's Log answers the four questions in Build step 3, each from a
   command run on a real chain in this repository.
4. `concurrency.md` describes the procedure the pilot supports, and repo-48's
   Log points here.

## Review

**Gate: PASS** (for the slice the dispatch scoped: Build step 1 only) — 2026-10-10 · `7709411e..13b707b5` · Sonnet 5.5, depth narrow

Acceptance for the unbuilt lines came from the dispatch: the owner decided on
2026-10-10 to merge the guard alone first, show its refusal on `main`
afterwards, and give step 2 to a fresh builder on a new branch. No spec reads
the `permissions.deny` list (`scripts/test/hooks.test.ts` reads `settings.json` only for the hooks
wiring), so nothing in `npm test` proves any row below; "verified" means I ran it.

| Done when                                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `gh stack merge` is refused by a deny rule in `.claude/settings.json`, shown by the refusal               | **Rule half: verified.** `Bash(gh stack merge*)` sits in `permissions.deny`; the file parses; a model of the documented matcher denies 10 of 10 merge spellings and a scratch copy without the entry denies 0 of 10 (attacks 1 and 2 below). **Refusal half: unproven (scope)** — the dispatch (owner, 2026-10-10) moved it to `main`, to be shown in a session that started after the merge and before step 2. This also fits `awaiting` (event: the merge of #412; reading: `gh stack merge --help` in a post-merge session prints `Permission to use Bash with command gh stack merge --help has been denied.`); I graded it as the dispatch said, and the lander may carry it into `awaiting:` |
| 2. Extension installed at a pinned tag by `.devcontainer/Dockerfile`; download host in `allowed-domains.txt` | **unproven (scope)** — owner, 2026-10-10: a fresh builder on a new branch does step 2. The branch touches neither file. The brief's tag is stale: v0.2.1 is current (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3. Log answers the four Build-3 questions from commands run on a real chain                                  | **unproven (scope)** — same decision; the pilot needs the extension installed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4. `concurrency.md` describes the supported procedure; repo-48's Log points here                             | **unproven (scope)** — same decision; follows the pilot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Head 13b707b5, pull request #412 (draft), read 2026-10-10.** `check` (both),
`codeql`, `CodeQL`, `dependency-review` and `changes` are green. `test
(ubuntu-latest)` and `test (windows-latest, informational)` were still
`IN_PROGRESS`; no row above depends on them. The title passes
`node scripts/commit-message.mjs --text` (exit 0).

### What I ran

**1. Does the pattern catch every way the extension merges?**

- `github/gh-stack` at its newest release: the releases page lists v0.2.1
  (2026-10-09), v0.2.0 (2026-10-02), v0.1.1 (2026-09-02) in that order, so the
  Log's "v0.2.1 is newest" holds, and the asset list for v0.2.1 includes
  `linux-amd64` (WebFetch of `releases/expanded_assets/v0.2.1`). The README's
  command reference lists `init add checkout rebase modify sync push submit link
merge view unstack(delete) up down top bottom trunk switch feedback alias`.
  **`merge` is the only subcommand that merges**, with `--merge-method`,
  `--merge`/`--squash`/`--rebase` and `-y/--yes`. `submit --open` and
  `link --open` only mark drafts ready, `sync --prune` deletes local branches,
  `submit --auto` only auto-generates titles. No flag on any other subcommand
  enables auto-merge or merges. `gh stack merge --help` for v0.2.1 itself was
  not run: the extension is not installed (`gh extension list` printed nothing,
  exit 0), so the flag list is the README's, which is on `main` and may be ahead
  of the release.
- The Claude Code permissions page says a trailing ` *` also matches the bare
  command, and `Bash(ls*)` with no space "matches `lsof` too". So the new
  `Bash(gh stack merge*)` matches `gh stack merge` with no arguments, with
  `--help`, with a number, and with any flags, and so does the existing
  `Bash(gh pr merge *)`. The new rule is the wider of the two (it would also
  match a subcommand named `mergefoo`, which does not exist: dropped).
  Precedent for the no-space form is `Bash(gh auth token*)` and
  `Bash(npm publish*)` in the same list.
- `node model.mts <settings.json>` in the scratch directory implements the
  documented semantics (trailing-space star, separators `&& || ; | |& &`,
  stripped wrappers `timeout time nice nohup stdbuf command builtin noglob`,
  leading `VAR=value` ignored by deny rules). It is a reading of the
  documentation, not the harness. On the branch's file it denies: `gh stack
merge`, `… --help`, `… 12`, `… --squash`, `… --rebase -y`, `… --merge-method
squash --yes 3`, `GH_TOKEN=x gh stack merge -y`, `timeout 30 gh stack merge
-y`, `cd /tmp && gh stack merge -y`, `echo y | gh stack merge` (10 of 10),
  and passes `gh stack view`, `sync`, `submit --open`, `link a b --open`, `push`.
- **Positive control.** The same model on a scratch copy with the entry deleted
  (`diff` shows the single line `Bash(gh stack merge*)` removed): the same 10
  merge spellings print `MISS pass`, while the two `gh pr merge` baselines still
  print `ok deny`. The model can fail.
- A live check of the whitespace worry: `gh  api --help` (two spaces, against
  `main`'s `Bash(gh api *)`) printed `Permission to use Bash with command gh  api
--help has been denied.` So the harness normalises a double space; `gh  stack
merge` is covered.
- **What would slip through** (the permissions page's "What a Bash rule doesn't
  match", plus `gh` itself; none of these was run, because probing another
  spelling of a deny is what the repo's CLAUDE.md says not to do):
  `gh extension exec stack merge -y` (and `gh ext exec …`), `/usr/bin/gh stack
merge -y`, `bash -c 'gh stack merge -y'`, a quoted `gh stack 'merge'`,
  `gh alias set <name> 'stack merge'` then `gh <name>`, and `gh stack alias`,
  which installs a `gs` wrapper script in `~/.local/bin` forwarding all
  arguments, so `gs merge -y`. Whether `~/.local/bin` is on `PATH` here is not
  measured. All are inert today and become live only when step 2 installs the
  extension.
- **The hook layer does not cover it either.** `.claude/hooks/check-main-writes.sh`
  blocks `gh pr merge` in any spelling with a segment regex that names `pr`.
  Fed a PreToolUse payload: `gh stack merge -y` exits **0**; the control `gh pr
merge -y` exits **2** (inputs in the scratch directory, `bash
.claude/hooks/check-main-writes.sh < <file>`). See F1.

**2. Parse and placement.** `node -e "JSON.parse(…)"` on the branch's
`.claude/settings.json`: parsed, `permissions.deny` has 8 entries, the second is
`Bash(gh stack merge*)`. On the scratch copy without it: parsed, 7 entries,
`includes` false. **The bare `JSON.parse` check passes on both files and cannot
tell them apart**; the `includes` check and the matcher model can.

**3. The Log's claims, each against a command of mine.**

- `gh extension list` printed nothing, exit 0. Holds.
- `gh --version` prints `gh version 2.101.0`. Holds.
- `gh stack merge --help` in this gate's session, with the branch's file checked
  out in the worktree: not refused; it printed `gh stack is available as an
official extension. To install it, run: gh extension install github/gh-stack`,
  exit 1. Holds.
- `gh api --help`: `Permission to use Bash with command gh api --help has been
denied.` Holds (it is `main`'s rule).
- `gh pr merge --help`: `PreToolUse:Bash hook error: … Merging a pull request is
the owner's decision, not an agent's.` Holds, and the Log is right that this
  probe cannot separate the hook from the deny list.
- `origin/main:.claude/settings.json` and the shared checkout's
  `/workspaces/tools/.claude/settings.json` both have no `stack` line (grep exit
  1 on each). Holds: nothing stands between `gh stack merge` and a merge in a
  session that loaded `main`'s rules, except the extension's absence.
- **A control the Log lacks, run by me.** The Log's non-refusal of `gh stack
merge --help` cannot separate "the rule is not loaded" from "the pattern does
  not match". I added `Bash(echo worktreecontrol*)`, a pattern that trivially
  matches, to the detached worktree's file beside the new entry and ran `echo
worktreecontrol`: it ran and printed `worktreecontrol`; `gh stack merge --help`
  was still not refused. A worktree-only rule that cannot fail to match does not
  fire either, so the non-refusal is the loading, not the pattern. I restored the
  file with `git checkout 13b707b5… -- .claude/settings.json`; `git status
--short` is empty. The Log's conclusion holds.

**4. Does the slice leave the ticket coherent?** Mostly. `status: ready`
unchanged (`npm run status -- --show repo-95`: `status ready`, `awaiting —`,
`unblocked`); the diff touches only the rule and the Log. The gap is F3.

### Findings

- **low** · `nfr:security` · no `Done when` line depends on it · **no live call
  site until step 2 installs the extension.** F1: `check-main-writes.sh` covers
  `gh pr merge` only, so after step 2 the deny rule is the sole layer for `gh
stack merge`, and it is the glob matcher whose measured escapes the hook was
  written to close. **Open decision, for the step-2 builder:** (a) extend the
  hook's merge segment regex to `gh pr merge` and `gh stack merge`, with a case
  in `scripts/test/hooks.test.ts` and a control that fails without it; (b) keep
  the deny rule alone, as the brief says. Recommend (a), done before the install
  in step 2: it costs one regex and one test, and the hook is what holds a bare
  or odd spelling. Whichever is chosen, the hook change is unobservable until it
  reaches `main` (the same pre-merge limit as the rule), so it needs the same
  merge-first order.
- **low** · `nfr:maintainability` · F2: the Log states the mechanism as
  "a session loads its permission rules and hooks from the shared checkout's
  `.claude/settings.json`" and its control is a different rule on a different
  file. The Log's measurements fit equally "resolved once at session start", the
  wording `check-main-writes.sh`'s header and `history.md`'s repo-22 entry use.
  The conclusion is right (my control above), but
  the follow-up needs the narrower reading: the post-merge refusal has to be
  shown in a session **started after** the merge, in a checkout whose
  `.claude/settings.json` has the line. The shared checkout's file has none today.
- **low** · F3: the Log's last entry ends "the next move is the owner's" and
  "Steps 3 and 4 are `unproven (scope)`", written before the owner chose. Once
  this merges it reads as a ticket waiting on a decision already taken, and Build
  step 1 still says "Add `Bash(gh stack merge*)`", which is done. A fresh builder
  has to infer that the add is merged, that its refusal is still unshown and goes
  first, and that step 2 is theirs. Fixable at the landing with no re-gate, one
  Log sentence: _"2026-10-10 — owner chose to merge the guard alone first (over
  adding the deny to `~/.claude/settings.json`, installing now and accepting the
  gap, or dropping the pilot). #412 carries step 1's rule; its refusal is shown
  on `main` in a session started after the merge, before step 2 is built on a new
  branch."_
- **dropped** · `Bash(gh stack merge*)` over-matches a subcommand `mergefoo`. No
  such command exists in the README's list; no live call site.
- **dropped** · the pattern misses `gh stack merge` with no arguments. It does
  not: no-space `merge*` matches the bare command under either reading of the
  trailing-star question that `check-main-writes.sh`'s header leaves open, which
  is a point in the rule's favour (model: `gh stack merge` denied).
- **dropped** · a double space or a flag before the subcommand defeats the match.
  Double space: refuted by the live `gh  api --help` denial above. Flags before
  the subcommand: the README documents none for `gh stack`.
- **dropped** · `submit --open`, `link --open`, `sync --prune` or `submit --auto`
  merge. README: they do not.
- **findings** · the hunt returned 7; 3 carried (F1 to F3), 4 dropped.
- NFR: security — the deny list is a guardrail and not a boundary (root
  CLAUDE.md, "What is denied"); the slips are listed above and inert until the
  install · performance n/a · reliability — the rule is inert in every session
  that began before the merge, F2 · maintainability — F3.
- Invariants walked: the ticket's Log was appended (CLAUDE.md, "Append to a
  ticket's Log"); the commit and title scope pass `commit-message.mjs`; no tool
  imports, errors, URLs, spawns, tests or workspaces are touched. Not run: `npm
test` (no code changed; CI's `test` legs were still running on this head).

### Gate 2

**Gate: PASS** (for the slice the dispatch scoped) — 2026-10-10 · `13b707b5..714a8796` · Sonnet 5.5, depth narrow

The round is one commit, `714a8796`, touching `.claude/hooks/check-main-writes.sh`,
`scripts/test/hooks.test.ts` and the ticket's Log. Gate 1's rows are unchanged:
Done when 1's rule half is now held by two layers (the deny rule and the hook),
its refusal half and Done when 2, 3 and 4 stay `unproven (scope)` on the owner's
2026-10-10 decision. Nothing in this round is a `high`.

**Gate 1's findings.**

- **F1: fixed.** The hook's merge match is now `gh (pr|stack) merge`. Driven with
  the same payload gate 1 used (`bash .claude/hooks/check-main-writes.sh < <file>`
  with a `gh stack merge -y` PreToolUse payload): exit 0 at `13b707b5`, exit 2 at
  this head, with the refusal text unchanged ("Merging a pull request is the
  owner's decision, not an agent's…").
- **F2: not fixed, recorded** — the owner's choice on 2026-10-10.
- **F3: not in this round.** The owner chose "apply F3 at landing"; the lander
  does it, so it is not graded as unfixed here.

**Attack 1: the hook.** `drive.mts` in the scratch directory feeds 59 payloads to a
hook and compares its exit code with the expected one; run on this head's hook it
reports **59 of 59 as expected, 0 mismatches**.

- Refused (exit 2), 13 `gh stack merge` shapes: bare, `-y`, `--squash 12`,
  `--merge-method squash --yes 3`, `--help`, after `&&`, after a pipe, after `;`,
  inside `( )`, on a second line, with doubled spaces, with tabs, with leading
  spaces.
- Still refused, the 5 `gh pr merge` spellings `hooks.test.ts` covers
  (`129 --squash`, `129 --auto --squash`, bare, `--repo owner/other 7`,
  `cd /tmp && … 129`).
- Silent (exit 0), 20 other `gh stack` subcommands and flag shapes (`view`,
  `sync`, `sync --prune`, `submit --open`, `push`, `link a b --open`, `unstack`,
  `rebase`, `checkout 3`, `init`, `add -A -m x`, `up`, `down`, `top`, `bottom`,
  `trunk`, `switch`, `alias`, `feedback`, `view --json`), and 21 routine or
  near-miss commands: `git merge origin/main`, `git merge --no-edit origin/main`,
  `git merge --abort`, `gh pr view 5 --json mergeable`, `… mergeable,mergeStateStatus,mergedAt`,
  `gh pr checks 412`, `gh pr list --search is:merged`, `gh pr ready 412`,
  `gh stack sync && git merge origin/main`, `gh stack view | grep merge`, the
  command inside an `echo`, double quotes and single quotes, in a one-line
  `git commit -m "…"`, in `grep -rn "…" docs`, in `git log --grep='…'`,
  `gh stack mergefoo`, `gh stack merged`, `gh extension list`,
  `gh extension install github/gh-stack` (step 2's own command) and
  `npm run status -- --show repo-95`.
- **Positive control.** The same 59 payloads against the hook as it stood at
  `13b707b5` (saved to the scratch directory): **13 mismatches**, exactly the 13
  `gh stack merge` shapes now exit 0; the `gh pr merge` rows and every silent row
  are unchanged. The driver can fail.
- **No false positive on a routine command.** One routine shape does refuse, with
  exact parity to `gh pr merge` (`parity.mts`): a heredoc or `$(cat <<'EOF' …)`
  commit message whose body has a **line that starts with** `gh stack merge`
  exits 2 for it and for `gh pr merge` alike, because the hook splits on newlines
  after stripping only single-line quoted spans. The same text mid-line, or in a
  one-line `-m "…"`, exits 0 for both. This is the existing, documented
  line-start behaviour and the test file's `STACK_MERGE` constant is spelled in
  pieces for the same reason. It matters for step 3's Log and any commit body
  written through a heredoc, so a line there should not begin with the command.
  Not a finding: it is the hook's established ceiling, not something this round
  introduced.

**Attack 2: the new test.** `scripts/test/hooks.test.ts`, "check-main-writes
refuses a stacked-pull-request merge as it refuses a pull request merge".

- At this head: `npx vitest run scripts/test/hooks.test.ts` → `Tests 34 passed (34)`.
- With the hook reverted (`git checkout 13b707b5… -- .claude/hooks/check-main-writes.sh`):
  `Tests 1 failed | 33 passed (34)`, `AssertionError: gh stack merge: expected +0 to
be 2`. The fixer's "1 failed | 33 passed" reproduces. A hook that does nothing
  fails the refuse half, so the "contains no X" companion rule is met.
- The silent half can fail too. Mutation A (regex widened to any `gh (pr|stack)`
  subcommand): the new test fails on `gh stack view: expected false to be true`
  (and `check-main-writes stays out of the way of commands that cannot push`
  fails on `gh pr list --state open`). Mutation B (the `^[[:space:]]*` anchor
  dropped): the new test fails on `echo gh stack merge: expected false to be
true`. Each mutation made 1 or 2 tests red; I restored the hook with `git
checkout 714a8796… -- .claude/hooks/check-main-writes.sh` after each and
  `git status --short` is empty.
- The test is the last `test(` in the file and the file ends with its closing
  brace. The round also adds one line, `const STACK_MERGE`, beside `MERGE` and
  `PUSH` above the tests; it moves every later line by one. Three tickets' records
  cite `hooks.test.ts` by line (repo-15, repo-22, repo-42), but the citation
  checker is retired (adr/006), so nothing reads them; not a finding.

**Attack 3: the Log entry.** Each command in it reproduces.

- `gh stack merge -y` exit 0 then 2, `gh pr merge -y` exit 2 then 2, control
  `gh stack view` exit 0 then 0: `check3.mts` against the saved `13b707b5` hook
  and this head's, same three values.
- "Failed with the hook reverted (`gh stack merge: expected +0 to be 2`, 1 of
  34), passes with it (34 of 34)": reproduced as above.
- "The hook's own refusal is unobservable in a session until it reaches `main`":
  `gh stack merge --help` in this gate's session, with the branch's hook in the
  worktree, printed `gh stack is available as an official extension…` and exited
  1; the hook did not fire. Holds.
- The entry changes no earlier Log line (the commit's only change to the file is
  15 added lines).

**CI.** On head `714a8796`: `check` (both), `codeql`, `CodeQL`,
`dependency-review` and `changes` are green; `test (ubuntu-latest)` and `test
(windows-latest, informational)` were `IN_PROGRESS` when read. No row depends on
them; I ran the hooks suite myself (34 of 34).

### Findings

- **low** · `nfr:maintainability` · no `Done when` line depends on it · F4: the
  new comment in the hook's merge loop says `gh extension exec`, an absolute path
  to gh and an alias "are the ceiling of a command-string hook, stated in the
  header", and the Log says "the ceiling the hook's header already states". The
  header's INDIRECTION bullet names a shell alias and, through CLAUDE.md's
  "`/bin/echo` defeats a deny on `echo`", an absolute path; it never mentions
  `gh extension exec` (grep for "extension exec" in the file finds only the new comment).
  The header's first line also now reads "`gh pr merge` and `gh stack merge` in
  any spelling", which the comment beside the code contradicts ("Only the exact
  spellings are matched"). Fixable at the landing with no re-gate: add
  `gh extension exec stack merge` to the INDIRECTION bullet, one clause. The
  other remedy is to reword the code comment to "the INDIRECTION limit in the
  header"; I recommend the header edit, since the next editor reads the header.
  No live call site until step 2 installs the extension.
- **dropped** · the heredoc line-start refusal above as a regression: it is
  identical for `gh pr merge` before this round and is the documented ceiling.
- **dropped** · the new line in the file above the tests moving later lines: no
  reader of those line numbers remains.
- **findings** · the round returned 3 candidates; 1 carried (F4), 2 dropped.
- NFR: security ✓ (two layers now; the slips from gate 1 remain inert until the
  install) · performance n/a · reliability ✓ (59 of 59 payloads, 13 of 13
  flipped) · maintainability — F4.
- Not run: the full `npm test` (the other legs belong to CI), and the hook's
  refusal in a live session, which cannot happen before the merge.
- **Is anything here a `high`?** No.

## Log

- 2026-10-06 — filed by tools-b2 from the owner's answer to "How should
  repo-48's decision change toward gh stack?". Options: pilot with gh stack,
  then adopt (recommended, chosen); adopt outright; keep Option 1 with the
  website pilot. The timings above come from `gh pr view` at filing, and the
  stall reading comes from tools-79's transcript.
  Rated `hard`: step 3 has to happen inside a live batch, and its result
  decides how the builder roles handle `main`.
- 2026-10-10 — builder, branch `repo-95-pilot-gh-stack-extension` off `7709411e`.
  **Stopped after step 1, before any install: the deny rule this branch adds
  does not bind for anyone until it merges.** Build step 1 asks to watch
  `gh stack merge --help` be refused on the branch that adds the rule, and that
  cannot happen. A session loads its permission rules and hooks from the shared
  checkout's `.claude/settings.json`, which is on `main`, and not from its
  worktree. The same thing was recorded for hooks in
  `.claude/skills/orchestrate-tickets/reference/history.md` (repo-22) and in
  `check-main-writes.sh`'s header (repo-42). Measured in one session, with
  `Bash(gh stack merge*)` added to this worktree's `.claude/settings.json`:
  - `gh stack merge --help` was **not refused by the harness**. It reached gh,
    which printed its own message for an extension that is not installed, and
    exited 1:
    `gh stack is available as an official extension. To install it, run: gh extension install github/gh-stack`.
  - Control: `gh api --help`, held by `main`'s `Bash(gh api *)`, printed
    `Permission to use Bash with command gh api --help has been denied.`
    So deny rules do bind in this session, but only the ones on `main`.
  - `gh pr merge --help` was refused by the shared checkout's
    `check-main-writes.sh` hook (`PreToolUse:Bash hook error: … Merging a pull
request is the owner's decision`). The hook fires before the deny list is
    consulted, so this probe cannot tell the two layers apart.

  So nothing stands between `gh stack merge` and a merge until the rule reaches
  `main`. The extension is the only thing that does, by being absent:
  `gh extension list` printed nothing. Step 2 (install, `Dockerfile`,
  allowlist) is therefore not done, and the next move is the owner's. Steps 3
  and 4 are `unproven (scope)`.

  Also wrong in the brief: v0.1.1 is no longer the current tag. The releases page
  (github.com/github/gh-stack/releases, read 2026-10-10) lists v0.2.1
  (2026-10-09) and v0.2.0 (2026-10-02) above it, and v0.2.1 has a
  `linux-amd64` asset. gh here is 2.101.0.

- 2026-10-10 — fixer, gate 1's F1. The owner answered "Should the step-2 builder
  also extend the hook, and when?" with "Extend the hook, in this slice before
  merge", over "in step 2's branch" and "deny rule alone, as the brief says". So
  `.claude/hooks/check-main-writes.sh`'s merge match is now `gh (pr|stack) merge`,
  with a case in `scripts/test/hooks.test.ts`, and it lands in #412 before
  anything is installed. A PreToolUse payload fed to the hook, before and after
  (`bash <hook> < payload`): `gh stack merge -y` exit 0 then exit 2;
  `gh pr merge -y` exit 2 then exit 2; the control `gh stack view` exit 0 then
  exit 0. The new test failed with the hook reverted
  (`gh stack merge: expected +0 to be 2`, 1 of 34) and passes with it
  (34 of 34, `npx vitest run scripts/test/hooks.test.ts`). The hook's own refusal
  is unobservable in a session until it reaches `main`, the same limit as the
  deny rule. Not widened: `gh extension exec`, an absolute path to gh and an
  alias stay with the ceiling the hook's header already states.

- 2026-10-10 — lander, gate 1's F3. The owner chose to merge the guard alone
  first, answering "Merge the guard alone first" over "owner adds the deny to
  `~/.claude/settings.json`", "install now, accept the gap" and "drop the pilot".
  #412 carries step 1's rule (and the hook extension above); its refusal is shown
  on `main` in a session started after the merge, before step 2 is built on a new
  branch. The earlier entry's "the next move is the owner's" is that question,
  since answered. The ticket lands `in-flight`: steps 2 to 4 remain.
