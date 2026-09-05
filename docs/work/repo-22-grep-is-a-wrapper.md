---
id: repo-22
tool: repo
title: The grep command here is a wrapper that silently honours ignore files
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# repo-22 — `grep` here is a wrapper that silently honours ignore files

**Files:** `.claude/hooks/check-tree-grep.sh` (new),
`.claude/hooks/check-pr-title.sh`, `.claude/settings.json`.

**Both decisions are answered. This ticket is startable.** The hook is the only
carrier, so its header comment has to hold the whole reasoning — and **Decision
two widened the ticket**: it also fixes a misfiring anchor in the shipped
`check-pr-title.sh`, because this ticket's Build was about to copy it.

## Why

In this devcontainer `grep` is a bash **function**, not GNU grep. It execs a
bundled `ugrep` under a fixed flag set:

```
-G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg …
```

So every `grep` an agent types honours ignore files and skips binaries. There is
**no warning and no exit-code signal** — which is what makes it worse than the
two sibling footguns below, each of which at least leaves something behind.

Reproduction, needing no repository (measured 2026-09-05). Paste it whole:

```bash
d=/tmp/grep-wrapper-demo; rm -rf "$d"; mkdir -p "$d/ignored"
printf 'ignored/\n*.log\n' > "$d/.gitignore"
echo NEEDLE > "$d/tracked.txt"; echo NEEDLE > "$d/ignored/hidden.txt"
echo NEEDLE > "$d/build.log"; printf 'NEEDLE\x00\n' > "$d/blob.bin"
echo -n "grep:         "; grep -rl NEEDLE "$d" | wc -l          # 1
echo -n "command grep: "; command grep -rl NEEDLE "$d" | wc -l  # 4
grep -rl NEEDLE "$d" >/dev/null; echo "exit: $?"                # 0
```

It takes a literal path and never `cd`s on purpose: the worktree-isolation guard
refuses the `mktemp -d` plus `cd` spelling outright. Even this spelling was
refused once and accepted twice while the ticket was written, so **a refusal is
not a failed acceptance** — run the lines separately and the result is the same.

Five further facts, each measured:

- **The gap is content-dependent, not a constant.** In a clean worktree
  `grep -rl vitest .` and `command grep -rl vitest .` both return **183, with
  identical file sets** — nothing ignored here contains `vitest`. The gap grows
  with whatever ignored subtree happens to be in the tree, so two agents
  measuring the same thing get different answers. `git worktree list` showed
  **12** agent worktrees under the ignored `.claude/worktrees/`
  (`.gitignore:48`) while this was written, up from 8 a day earlier.
- **The wrapper is not exported** — `BASH_FUNC_grep` is absent from `export -p`.
  It applies only to commands typed into the Bash tool. A `#!/usr/bin/env bash`
  script, `bash -c`, a hook and CI all get real GNU grep, so an agent's manual
  check does not match what the repo's own scripts see. On the fixture above:
  inline 1, through a script 4, through `bash -c` 4.
- **The fixture must not contain the search term outside the files under test**,
  and this one does not: the probe script lives at `/tmp/grep-wrapper-probe.sh`,
  outside the searched tree, and `command grep -rl 'grep' /tmp/grep-wrapper-demo`
  returns nothing. A fixture that stores its own script in the directory being
  searched matches its own body and inflates every count by one — which happened
  to two independent reproductions of this finding on the day it was filed, and
  changed the numbers without changing the conclusion.
- **Stdin is unaffected**, because the suppressed flags only govern walking a
  tree. The documented id sweep in
  `.claude/skills/orchestrate-tickets/reference/concurrency.md` pipes into
  `grep -oE`, and both spellings returned the same answer here.
- **Path shapes differ**: the wrapper prints `tracked.txt`, GNU prints
  `./tracked.txt`. Two searches fed to `comm` or `diff` disagree on every line
  for that reason alone.

**Two siblings, already recorded — cite, do not restate:**

- `grep -l` under an alternation cannot say which alternative matched:
  `docs/work/repo-20-reviewer-setup-order-builds-the-wrong-tree.md`'s Log, on
  branch `docs/record-2026-09-04-orchestration-batch` (PR #148).
- A missing search path still prints matches from the paths that exist, warns on
  stderr and exits 2: the PR #148 thread.
- The family already has a note in
  `.claude/skills/orchestrate-tickets/reference/records.md`, opening "Measure
  that exit code without a pipe". Point at it; do not copy it.

## Decision — answered 2026-09-05, not open

**The question was:** where does the rule live — a block in `CLAUDE.md` (A), a
`.claude/rules/` file (B), or a `PreToolUse` Bash hook (C)?

**The answer, from the owner, relayed through the orchestrator: option C alone.**
Not A, and not A+C. The three options were put to them with the costings below.

- **B was ruled out on a measurement, and the measurement is the reason — keep
  it.** All five existing `.claude/rules/` files key on `paths:` globs matched
  against a file being _opened_. A `grep` is a Bash call, so no path reliably
  precedes it. The rules mechanism structurally cannot fire for this; it is not
  merely a weaker choice.
- **A was declined although it is the obvious option**, and a later reader will
  wonder why. Two reasons: the owner's standing constraint this session is less
  prose, and `CLAUDE.md` is read once at session start while this failure happens
  forty tool calls deep. A statement that arrives before the mistake is
  contemplated is not the same as a reminder that arrives as it is made.
- **So the hook is the only carrier.** There is no prose elsewhere to point at,
  which is why Build step 2 puts the reasoning in its header comment rather than
  in a doc. `.claude/hooks/check-pr-title.sh` already establishes that pattern —
  its header records the mechanism, the reason the hook exists, and the misfire
  on its own first live run.

## Build

1. Add `.claude/hooks/check-tree-grep.sh` and wire it into the existing
   `PreToolUse` `Bash` matcher in `.claude/settings.json`, alongside
   `check-pr-title.sh`. Both run; neither replaces the other.
2. **The header comment is the deliverable, not an aside.** It is the only place
   this reasoning will live, so it carries: that `grep` here is a bash function
   execing `ugrep` under `--ignore-files --hidden -I --exclude-dir=…`; that the
   result honours ignore files and skips binaries with no warning and no exit
   code; the fixture numbers from **Why** (1 against 4); that the wrapper is not
   exported, so scripts, hooks and CI see real GNU grep; that the two spellings
   print different path shapes, so piping both into `comm` or `diff` reports
   every line as divergent; and that `command grep` is the spelling for an
   exhaustive search. Follow the shape of `check-pr-title.sh`'s header.
3. Cite the two siblings and the `records.md` note by path, in the header.
   **Do not restate them** — a fact in two places is the defect `repo-21` exists
   to remove.
4. **Advisory, never blocking**: warn on stderr, `exit 0`. This fires on a
   correct command far more often than on a mistaken one, so a blocking exit 2
   would be wrong.
5. **Fix the anchor before using it — do not reuse it as-is.**
   `check-pr-title.sh`'s `(^|[;&|(]|&&|\|\|)` treats a raw `(`, `;`, `&` or `|`
   as a command boundary without checking it is a shell operator rather than a
   character inside a string, and it misfires. See **Decision two**, which
   carries the reproduction, the seven-shape table and a fix that measures
   clean.

6. **Fix `check-pr-title.sh` in the same change**, not only the new hook. That
   is the shipped instance, it is the one that blocked a real command in this
   session, and it is why this ticket widened. Mind the trap named in Decision
   two: strip quoted spans for the boundary test only, never for the title
   extraction.

7. Match a tree-walking `grep` only where it is being **invoked**, and not when
   it is already `command grep` or a VCS grep. **`-r` and `-R` appear inside
   bundled short-flag clusters**, and every example in **Done when** uses `-rl`.
   Match the cluster (`[[:space:]]-[A-Za-z]*[rR]`), not a standalone `-r`; a
   builder told only "`-r` or `-R`" can write `-r\b` and miss every real call
   site.

## Decision two — the anchor's paren-adjacent misfire, answered 2026-09-05

Raised by the filing gate on `5fed828`, reproduced independently here.
**Answered: remedy (b) — fix the anchor, in this ticket. Not open.**

`check-pr-title.sh`'s anchor treats any raw `(`, `;`, `&` or `|` before the
phrase as a command boundary, without checking it is a shell operator rather
than a character inside a string. **This is a live defect in shipped code, not
in this plan** — the hook rejects a harmless `printf` and exits 2:

```bash
a='gh pr '; b='create'
jq -n --arg c "printf 'see ($a$b thing) for details'" '{tool_input:{command:$c}}' > /tmp/probe.json
bash .claude/hooks/check-pr-title.sh < /tmp/probe.json; echo $?   # message, then 2
```

**Both quirks in that snippet are load-bearing; do not tidy them.** The phrase is
split across `$a$b` so the literal never appears in the command text — spelled
out, the live hook blocks the very call that builds its own test fixture, which
is the defect demonstrating itself. And it uses `jq` rather than a `python3`
heredoc because the worktree-isolation guard refuses the heredoc form outright.

It fired against a real Bash call in this session before it was isolated. Reused
verbatim for `-r`/`-R`, `echo "(grep -r x .) is risky"` misfires the same way,
while `echo 'grep -rl x .'` does not — **so the quote-adjacent shape in
Done when is the one the naive anchor already handles**, and the failing shape is
untested. Measured with the step 5 pattern:

| command                         | anchor matches |
| ------------------------------- | -------------- |
| `echo "(grep -r x .) is risky"` | yes — misfire  |
| `echo 'grep -rl x .'`           | no             |
| `grep -rl x .`                  | yes — correct  |
| `cd /tmp && grep -r x .`        | yes — correct  |
| `command grep -rl x .`          | no             |

### The answer, and why it went against the recommendation

Three options went to the owner: file it separately, fold it in, or accept it as
a named limitation. **They chose folding it in.** Their reasoning: this ticket's
Build already tells its builder to reuse this anchor, so the builder confronts it
either way, and fixing it before anything copies it beats documenting it as
accepted.

**The gate recommended (a), and the recommendation was sound** — it was the
cheaper option and consistent with what the repo already ships. The deciding fact
was not that (a) was wrong but that **this ticket propagates the anchor rather
than merely living beside it**. A limitation that is about to be copied is not
the same as one sitting still.

**The accepted cost, named so it does not read as drift:** this widens the ticket
past the grep wrapper. One branch will carry two subjects and squash-merge under
one changelog line.

**That cost lands on the implementation PR, not on the one that filed this
ticket** — and the two are easy to conflate, so they are separated here. The
filing PR builds no hook, so it is `docs(repo):`, which is `hidden` at
`release-please-config.json:31` and ships no changelog line; a `fix(repo):` title
on it would have announced behaviour that does not exist in the tree after it
merges. **The PR that builds the hook is the `fix(repo):` one**, `fix` being not
hidden at `release-please-config.json:27`, and it is the one that ships a
changelog line. Whoever builds
the hook should not read this paragraph as already accounted for. Check either
title with `node scripts/commit-message.mjs --text "<title>"` before opening.

**The frontmatter and the commit type answer different questions.** `kind: fix`
describes the _work_ — this ticket is a fix, and `difficulty: hard` is right for
it. The commit type describes what a _commit_ does. They diverge exactly here:
the ticket is a fix; the commit that filed it is documentation.

### What actually surfaced this, which is the lesson

The gate did not read the anchor and reason about it. **It ran the hook against a
harder input than `Done when` tested**, and then noticed the same misfire had
already fired against its own Bash call, live, minutes earlier. `Done when` only
exercised the quote-adjacent shape — the one the naive anchor happens to handle.
**A guard tested only on the shape it was written for is untested.** That applies
to the hook this ticket adds, which is why the paren-adjacent case is now an
acceptance line rather than a remark.

### A fix that measures clean, offered as a starting point

Strip quoted spans first, then apply the boundary anchor to what is left —
`sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g"`. Verified against all seven shapes,
both hooks:

| command                                | naive | stripped | wanted |
| -------------------------------------- | ----- | -------- | ------ |
| `echo "(grep -r x .) is risky"`        | 1     | 0        | 0      |
| `echo 'grep -rl x .'`                  | 0     | 0        | 0      |
| `grep -rl x .`                         | 1     | 1        | 1      |
| `cd /tmp && grep -r x .`               | 1     | 1        | 1      |
| `command grep -rl x .`                 | 0     | 0        | 0      |
| `printf 'see (gh pr create x) for …'`  | 1     | 0        | 0      |
| `gh pr create --title "feat(repo): x"` | 1     | 1        | 1      |

**The trap in implementing it:** strip only for the _boundary test_.
`check-pr-title.sh` extracts the title from `$cmd` with a `sed` that reads the
quoted span — substitute the stripped text for `$cmd` throughout and the title
becomes unfindable, turning every real `gh pr create` into the "without an
inspectable `--title`" rejection.

## Done when

Let `H=.claude/hooks/check-tree-grep.sh` throughout.

- The fenced block under **Why**, pasted into a shell, prints `grep: 1`,
  `command grep: 4` and `exit: 0`.
- **The hook fires, and does not block.**
  `printf '{"tool_input":{"command":"grep -rl x ."}}' | bash $H; echo $?`
  prints a warning on stderr and `0`.
- **It stays quiet on the four spellings that are already correct.** Each of
  these prints nothing and exits `0`:
  `command grep -rl x .` · `git grep -l x` · `grep -l x file.txt` (no `-r`) ·
  `echo "grep -rl x ."` (the command name inside a quoted argument, which is the
  misfire `check-pr-title.sh` recorded).
- **It fires after a shell operator**, not only at the start:
  `printf '{"tool_input":{"command":"cd /tmp && grep -r x ."}}' | bash $H`
  warns.
- **The header carries the reasoning**, not a pointer to it: each of
  `command grep -c 'ignore-files' $H`, `command grep -c 'command grep' $H`,
  `command grep -c 'not exported' $H` returns ≥ 1.
- **The siblings are cited, not copied**: `command grep -c 'repo-20' $H` and
  `command grep -c 'records.md' $H` each return ≥ 1, while
  `command grep -c 'alternation' $H` prints `0` and exits 1 — `grep`'s no-match
  code, not a failure.
- **It is wired**: `node -e "const s=require('./.claude/settings.json'); console.log(JSON.stringify(s.hooks.PreToolUse))"`
  names both `check-pr-title.sh` and `check-tree-grep.sh` under a `Bash` matcher.
- **The paren-adjacent shape is silent** — the gate's own reproduction, taken
  verbatim rather than re-derived:
  `printf '{"tool_input":{"command":"echo \"(grep -r x .) is risky\""}}' | bash $H`
  prints nothing and exits `0`. This is the shape the naive anchor got wrong;
  the quote-adjacent line above is the one it already handled.
- **`check-pr-title.sh` is fixed too, and still does its job.** With
  `a='gh pr '; b='create'`:
  `jq -n --arg c "printf 'see ($a$b thing) for details'" '{tool_input:{command:$c}}' | bash .claude/hooks/check-pr-title.sh; echo $?`
  prints nothing and exits `0`; while
  `jq -n --arg c "$a$b --title 'nope'" '{tool_input:{command:$c}}' | bash .claude/hooks/check-pr-title.sh; echo $?`
  still rejects and exits `2`. Both halves are required: the second is what
  proves the fix did not simply disable the guard.
- `npm run check` passes, `npm run format` leaves the tree clean, and
  `node scripts/status.mjs --json` exits `0`.

## The gate on this filing

**Gate: CONCERNS** — 2026-09-05 · reviewed at `5fed828` (`693e7f2`, `5fed828`, two commits) off `origin/main@c37cab9` · `origin/main...HEAD` · defect hunt run directly by the reviewer (no `code-review` delegate — this repo's skill reserves that delegation for the main session; the `ticket-reviewer` subagent runs its own hunt), medium depth, against a prose-only diff (one file, 214 insertions, no code)

This gates a pull request that only _files_ repo-22 — no hook, no wiring exists yet. Recorded under this heading rather than `## Review` per `docs/01-TICKETS.md`'s review gate and the `dl-29` precedent, since `status: ready` plus a `## Review` heading is read as merged work by the board check.

**Model:** builder ran Opus explicitly (`model: "opus"`). My own context carries, verbatim: "You are powered by the model named Sonnet 5. The exact model ID is claude-sonnet-5." Cross-model gate confirmed both directions.

| Claim                                                                                                               | Verification                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixture prints `grep: 1`, `command grep: 4`, `exit: 0`                                                              | **verified** — reproduced verbatim, twice (first paste refused by the worktree-isolation guard on the `.gitignore` line, identical second paste succeeded — matches the ticket's own disclosed flake)   |
| Fixture is not self-contaminated                                                                                    | **verified** — `command grep -rl 'grep' /tmp/grep-wrapper-demo` → 0 matches                                                                                                                             |
| "through a script 4" / `bash -c` 4                                                                                  | **verified** — independent probe script at `/tmp/grep-wrapper-probe.sh`, outside the fixture tree: script 4, `bash -c` 4                                                                                |
| `BASH_FUNC_grep` absent from `export -p`                                                                            | **verified**                                                                                                                                                                                            |
| Wiring line is falsifiable today, passes after build                                                                | **verified** — current `.claude/settings.json`'s only `PreToolUse`/`Bash` hook is `check-pr-title.sh`; the cited `node -e` line names only that today                                                   |
| Build artifacts are committable                                                                                     | **verified** — `git check-ignore` on both `.claude/settings.json` and `.claude/hooks/check-tree-grep.sh` exits 1 (not ignored)                                                                          |
| B's measurement (all `.claude/rules/` files key on `paths:` globs)                                                  | **verified** — exactly 5 files, all with `paths:` frontmatter, none keyed on command content                                                                                                            |
| `records.md` / `concurrency.md` citations resolve                                                                   | **verified** — `records.md:156` "Measure that exit code without a pipe", `concurrency.md:143` the `grep -oE` line                                                                                       |
| `repo-20`, `repo-21` sibling content                                                                                | **not independently checkable** — both live on unmerged branches (PR #148, `origin/repo-cleanup-orchestrate-skill`) not present in this tree; not a defect, just outside what this worktree can confirm |
| Log's disclosure (premature "through a script 4" figure; the unrecorded contaminated first fixture) survives intact | **verified** — present, unsoftened                                                                                                                                                                      |
| `npm run check`, `npm run format`, `node scripts/status.mjs --json`, `-- --show repo-22`                            | **verified** — all exit 0; ticket file already correctly formatted                                                                                                                                      |

**med · Build step 5's guard against its own named failure mode is a gesture, not a closed one — reproduced live.** Step 5 says: "A hook about grep that misfires on the word grep in a search pattern would repeat [check-pr-title.sh's recorded misfire] exactly," and prescribes reusing check-pr-title.sh's `(^|[;&|(]|&&|\|\|)` anchor as the guard. I tested that exact anchor, in the exact script the ticket cites, against a shape one step harder than the one Done-when tests (`echo "grep -rl x ."`, safe because a quote — not an anchor character — precedes the phrase):

```
$ echo '{"tool_input":{"command":"printf '"'"'see (gh pr create thing) for details'"'"'"}}' | bash .claude/hooks/check-pr-title.sh
gh pr create without an inspectable --title. ...
exit: 2
```

A harmless `printf` that only _mentions_ `gh pr create` inside a quoted string, preceded by a stray `(`, is blocked — this fired live against my own Bash tool call in this very review session before I built the offline reproduction above, which confirms it against the script directly. The anchor treats any raw `(`, `;`, `&`, or `|` character preceding the phrase as a command boundary, without knowing whether it's really a shell operator or just a character sitting inside a string. Reusing it verbatim for `grep -r`/`-R` inherits the same hole: `echo "(grep -r x .) is dangerous"` would misfire the same way, and nothing in Done-when tests that shape — only the quote-adjacent one, which was never at risk. This is a decision with two defensible remedies, not a clean verdict:

- **(a)** accept the residual risk as consistent with what the repo already ships in `check-pr-title.sh`, and say so explicitly in the header comment as a named, accepted limitation (cheap, consistent with precedent, leaves the hole documented rather than hidden).
- **(b)** tighten Build step 5 to also require the paren-adjacent shape not misfire, and add a Done-when line for it (closes the hole, costs the future builder more regex work than "copy check-pr-title.sh's anchor").

I recommend (a) — it costs one sentence and matches what the repo has already accepted for the identical mechanism — but this is the builder's/owner's call, not mine to settle.

- **low · one Build/Done-when-unused fact under Why.** "Path shapes differ" (line 72-74 at `5fed828`; line 77 at the tip) isn't cited by any Build step or Done-when line — it's true and harmless, but it's exactly the kind of bullet the ticket's own Decision section says the owner asked to minimize ("the owner's standing constraint this session is less prose"). "Stdin is unaffected" earns its place (it justifies not touching `concurrency.md`'s sweep); this one doesn't.
- **low · bundled short flags aren't spelled out.** Build step 5 says match `-r` or `-R` "where it is being invoked," but every Done-when example uses `-rl` (bundled with `-l`), never a bare `-r`. A future builder has to infer, rather than being told, that the match must also fire inside a combined short-option cluster (`-rl`, `-lr`, etc.), not just a standalone `-r` token. Costs one sentence to make explicit.
- **findings** · 3 returned, 3 carried, 0 dropped.
- NFR: security n/a (no code) · performance n/a · reliability n/a · maintainability — the two lows above; the med is a design-robustness question for the eventual build, not this filing.

## The gate on this filing — follow-up at `23d4bc3`

**Gate: PASS** — 2026-09-05 · re-verified at `23d4bc3` (four commits off `origin/main@c37cab9`) · all three findings above independently re-reproduced against the new tip and confirmed resolved, not accepted on the builder's report alone

- **med resolved.** Decision two's "strip quoted spans (`sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g"`), then apply the boundary anchor" fix was re-run by me independently, shape by shape, not read off the table. All seven published shapes match exactly, including the trap case `gh pr create --title "feat(repo): x"` (stripped text is `gh pr create --title `, still matches — confirmed). The owner chose remedy (b) over my recommended (a); the reasoning given (propagation vs. sitting still) is sound and I have no argument with it.
- Re-confirmed the _unfixed_ `check-pr-title.sh` still exhibits the original misfire today via the ticket's own jq-based, split-literal fixture (`a='gh pr '; b='create'; jq -n --arg c "printf 'see ($a$b thing) for details'" ...` → exit 2) — the fix is plan text only so far (`git diff --stat origin/main...HEAD` still shows just the one markdown file), consistent with this remaining a filing-only PR.
- Low 1 (path-shapes bullet) — accepted as given a job in Build step 2 rather than cut; a reasonable resolution of the option I offered.
- Low 2 (bundled short-flag clusters) — accepted as written (`[[:space:]]-[A-Za-z]*[rR]` in the renumbered Build step 7).
- Frontmatter (`kind: fix`, `difficulty: hard`) confirmed via `node scripts/status.mjs --show repo-22`. Confirmed `fix` is **not** `hidden` in `release-please-config.json` (line 27) — the eventual PR does ship a changelog line, so title it with care.
- `npm run check`, `npm run format`, `node scripts/status.mjs --json`, `-- --show repo-22` all still exit 0 at `23d4bc3`.

**The exchange is closed on my side.** Nothing outstanding.

## Log

**2026-09-05 — filed.** Every number above was re-measured in a fresh worktree
off `c37cab9`. Two of them corrected the brief that requested this ticket.

- The brief reported `183` vs `187` in a clean worktree. Here both spellings
  returned **183, with identical sets**; the only difference was the `./`
  prefix, which made a first `comm` run report all 183 files as divergent. The
  honest claim is not a number — it is that the gap tracks whatever ignored
  content is in the tree.
- The brief's own correction (that `.claude/worktrees/` produced its 2592-file
  reading, not the wrapper) is upheld, and is why this ticket leads with a fixed
  synthetic fixture instead of a repo-wide count.
- **Not measured:** the shared checkout `/workspaces/tools`. The command needed
  `--exclude-dir=.git`, which the worktree-isolation guard refuses from an
  isolated agent; it was not respelled. The 12-worktree count stands in for it.
- The id sweep ran both spellings and they agreed. `repo-22` is the union of
  `main`, the open PRs, and `origin/repo-cleanup-orchestrate-skill` — see the
  entry below for why that third source was needed.
- The worktree-isolation guard refused the reproduction once and accepted the
  same fixture twice, differing only in an `echo -n` label. Noted under **Why**
  so a reviewer does not read a refusal as a failed acceptance. Not filed
  separately: it is an observation about the harness, not about this repo.
- `difficulty: standard` rates the build now that the Decision is answered. The
  carrier is a shell matcher, not prose, and its predecessor misfired on its
  first live run.

**2026-09-05 — Decision answered, before any build.** Option C alone, from the
owner via the orchestrator. Recorded in `## Decision` rather than here, because
the next agent reads the Build section first and steps 1–5 changed with the
answer.

- **A number in this file was stated before it was measured, and is now
  measured.** "Through a script 4" was carried over from an earlier scratch
  fixture where it was 6, not from the `/tmp/grep-wrapper-demo` fixture the
  ticket publishes. Re-run against the published fixture with the probe script
  held outside the searched tree: inline 1, script 4, `bash -c` 4. The claim was
  right; it had not been run in the form the ticket asserts it.
- **That earlier scratch fixture had the self-match flaw**, and so did the
  orchestrator's independent reproduction: a probe script written into the
  directory being searched matches its own body and adds one to every count. Two
  reproductions, same trap, same day. Hence the fifth bullet under **Why** and
  the `command grep -rl 'grep' <fixture>` check that proves the published
  fixture is clean.
- The documented union-of-files id sweep in `concurrency.md` returned `repo-20`
  as the maximum and missed `repo-21` entirely, because
  `origin/repo-cleanup-orchestrate-skill` has no open PR. A live instance of the
  caveat that page already records; it prescribes `SendMessage`, which is how
  `repo-21` was in fact found.

**2026-09-05 — filing gate returned CONCERNS: 3 findings, 0 dropped.** This is
the builder's disposition of them. The gate record itself is the reviewer's text
and is not in this commit — there is no ship authority on this branch yet, and
it belongs above `## Log` under its own heading when there is.

All three were reproduced here before being accepted; none was taken on the
report alone.

- **med — the anchor Build step 5 prescribed misfires.** Reproduced twice: the
  live hook blocked the Bash call that was building the test fixture, and
  offline it exits 2 on a harmless `printf`. Escalated rather than settled, and
  the owner answered **(b)** — see **Decision two**, which records that the
  gate's own recommendation of (a) was sound and what outweighed it.
- **low — "Path shapes differ" had no consumer.** Given a job rather than cut:
  it is now in Build step 2's list of what the header must carry. It is a
  measured failure mode that produced a wrong reading in this session, so
  deleting it to satisfy the prose constraint would have traded the wrong thing.
- **low — `-r`/`-R` inside a bundled short-flag cluster.** Confirmed a builder
  could write `-r\b` and miss every `-rl` call site; step 5 now names the
  cluster pattern.
- The gate could not read `repo-20`'s and `repo-21`'s files — both are on
  unmerged branches invisible from this worktree. A limit on what it could
  check, not a defect.

**2026-09-05 — Decision two answered: fold the anchor fix in.** Scope widened
deliberately; the reasoning and the accepted cost are in **Decision two**, not
here, because the next agent reads Build first.

- `kind` moved `chore` → `fix` and `difficulty` `standard` → `hard`. The ticket
  now edits a shipped guard that blocks real commands, and the fix turns on
  distinguishing a shell operator from a character inside a string. That is a
  judgement call with live blast radius, not prose.
- The proposed fix — strip quoted spans, then anchor — was **measured before
  being written down**, across all seven shapes and both hooks, and one of those
  shapes (`gh pr create --title "feat(repo): x"`) is the one a careless strip
  would break. The trap that would break it is named in Decision two.
- Verified today that `check-pr-title.sh` still exits `2` on a genuinely bad
  title, so the second half of that acceptance line can fail and is worth
  asserting.

**2026-09-05 — the frontmatter `title` was reworded to dodge a parser defect,
and this is a workaround, not a fix.** It is not a style choice. The title
originally opened with a backticked `` `grep` ``, which YAML reserves as an
indicator character, so it had to be quoted — and `parseScalar`
(`scripts/status.mjs:115-118`) never strips quotes:

```js
const trimmed = value.trim();
return trimmed === "null" || trimmed === "" ? null : trimmed;
```

So `npm run status` and `-- --show repo-22` rendered the title with literal `"`
marks, alone among every ticket on the board. Dropping the leading backtick
removes the need to quote and the symptom with it; **the parser still keeps
quotes on any title that genuinely needs them.** Filed separately so this PR
stays scoped, and this entry is the live reproduction that ticket cites.
`repo-23`'s filer hit the same wall and sidestepped it the same way, which is
how it was found.

**The parser defect has two independently attested instances, not one plus an
anecdote**, and the second was verified rather than relayed.
`docs/work/repo-23-deployment-reads-as-downloader-only.md` (on branch
`repo-deployment-doc-shape`) carries
`title: The deployment page reads as downloader-only for 286 lines before it is repo-wide`
under an H1 of ``# repo-23 — `02-DEPLOYMENT.md` reads as downloader-only for 286 lines``
— backticks kept in the heading, dropped in the frontmatter, reworded into a
plain scalar, and both reworded titles even open with "The". Two filers who
never spoke reached the identical workaround, which is the evidence that this is
a parser defect rather than either one's style. **repo-23 is not the fix
ticket** — it is about `docs/02-DEPLOYMENT.md` and is unrelated to the parser;
it is credited here only with the independent discovery.

**2026-09-05 — the filing PR is `docs(repo):`, not `fix(repo):`.** **Caught by
the orchestrator, not by this builder** — recorded that way because "caught
before opening" read as self-caught, and the reviewer corrected the attribution.
Having moved the ticket's `kind` to `fix`, this builder carried that into the
_commit type_, pre-checked a `fix(repo):` title, proposed it, and was told the
type was wrong and why. It would have shipped a changelog line announcing a hook
that does not exist in the tree after the merge. `kind` describes the work; the commit type describes the commit, and
they diverge exactly here. Decision two now separates the two PRs so the
`fix(repo):` note is not read as already spent. Measured: `docs` is `hidden` at
`release-please-config.json:31`, `fix` is not at `release-please-config.json:27`,
and the two sibling filing PRs (#148, #149) both use `docs(repo):`.

Both of those were originally written as a bare `` `:27` `` — shorthand, after
the same file had been named in full earlier in the sentence. **That is the
shape that defeats `citations.mjs`**: it has no notion of a file established
earlier in a sentence, so a bare `:27` is invisible to it, while a reader sees
the qualified path once and reads the shorthand as inheriting it. Two
occurrences, written by the same hand on the same day, and neither the builder
nor the reviewer saw it until the second one turned a slip into a pattern. The
failure is _shorthand after a qualified reference_, not a forgotten filename —
worth stating because the two want different fixes.

**2026-09-05 — built.** Branch `repo-grep-wrapper-hook` off `origin/main@06d905b`.
`.claude/hooks/check-tree-grep.sh` (new), `.claude/hooks/check-pr-title.sh`,
`.claude/settings.json`, `scripts/test/hooks.test.ts` (new). Every **Done when**
line was run as written, and every number below was measured here.

- **The anchor's misfire was reproduced before it was fixed, not after.** The
  shipped `check-pr-title.sh` exited `2` on Decision two's `printf` fixture; the
  fixed one exits `0`, and still exits `2` on `--title 'nope'`. The reproduction
  is now a test, and it was _watched going red_: stash only the hook fix, re-run
  the file, and exactly one of its twelve tests fails with the other eleven
  green. The same was done for the new hook — point its anchor back at the
  unstripped command and exactly the paren-adjacent test fails, which is what
  makes the strip load-bearing there rather than decorative.
- **The ticket asked for hand-run acceptance, and a hand run does not survive.**
  A suite is the fold-in. The shapes now run on every push in the `repo` vitest
  project, which already includes `scripts/test/**` — so this cost no change to
  `vitest.config.ts` and no entry in `scripts/test/tsconfig.json`, the file being
  TypeScript rather than another `.mjs`. Nothing else in the repo reads a `.sh`;
  `npm run check` does not.
- **Two `Done when` lines cannot fail, and are recorded as weak rather than
  passed quietly.** `git grep -l x` and `grep -l x file.txt` must both stay
  quiet, but neither carries `-r`, so both stay quiet even against a hook whose
  command-word rule is broken. `git grep -rl x` is the shape that _can_ fail, and
  it is in the suite beside them.
- **Build step 7's flag pattern misses the long forms.** `-[A-Za-z]*[rR]` is
  right about the cluster and cannot match `--recursive` or
  `--dereference-recursive`, because the character after the first `-` is another
  `-`. Both are now matched explicitly. Folded in rather than left: it is the
  same behaviour the step is about, and a miss is silent.
- **The exclusion list is the boundary anchor, not a second rule.** The wrapper
  is a bash _function_, so it applies only when `grep` sits in the command-word
  slot; under `command grep`, `git grep`, `sudo grep` or `xargs grep` the real
  binary runs. That is why an anchor is the right test rather than an
  approximation of one, and why no separate exclusion pattern was written.
- **Not measured: whether an advisory on stderr reaches the agent that typed the
  command.** The hook does what step 4 prescribes and the acceptance pins it. But
  `.claude/settings.json` is read at session start, so the new hook was not live
  in the session that wrote it — a `grep -rl` typed here after the wiring landed
  produced no warning, which is equally explained by "not loaded yet" and by
  "`exit 0` stderr is not surfaced to the model". The two cannot be told apart
  from inside this session. An open question for the first session that starts
  with this merged, not a defect found here.
- **The worktree-isolation guard refused several spellings, again.** A pipe into
  `bash <hook>`, a `while` loop over the shapes, and a heredoc whose body
  contained a `git grep` example were each refused; acceptance ran as
  `bash <hook> < fixture.json` instead, and the test file was written with the
  Write tool. Same class the ticket already records under **Why**; not filed
  separately.
- **`status` stays `ready`.** The gate has not run, and there is no ship
  authority on this branch. It moves to `done` in the commit that lands the gate
  record, which is also what keeps `reviewedButReady` empty
  (`scripts/status.mjs:291`).
- **Two stale citations in this file were found and deliberately left alone.**
  `node scripts/citations.mjs docs/work/repo-22-grep-is-a-wrapper.md` exits `1`:
  the gate record's `records.md:156` anchor is now at `:192`, and the Log's
  `scripts/status.mjs:115-118` no longer holds `parseScalar`, which is at
  `143-145`. Both were written against an earlier tip and moved when #148
  merged; neither was introduced here, and `citations.mjs` runs in no workflow
  and in no `package.json` script, so this is not a red pipeline. Not repointed
  because one of them sits inside a reviewer's gate record, which is not this
  builder's text to edit — raised to the orchestrator instead.
