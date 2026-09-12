---
id: repo-43
tool: repo
title: A worktree's nested path silently shadows the shared root's copy of the same file
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-43 — A worktree's nested path silently shadows the shared root's copy of the same file

## Why

A dispatched agent's worktree lives at
`/workspaces/tools/.claude/worktrees/agent-<id>/`, which is **nested underneath
the shared root checkout's own path**, `/workspaces/tools/`.
`.claude/agents/builder.md:159 "Never touch `/workspaces/tools` itself"` already
warns against deliberately reaching for the shared root — but that line assumes
the danger is a chosen action. It is not only that. Because the worktree sits
inside the root's own path, an absolute path built from the literal prefix
`/workspaces/tools/<repo-relative-path>` is not an error and does not refuse —
it resolves, silently, to the **shared root's** copy of that file, which may be
on a different branch, at a different commit, or simply missing the edit the
agent believes it just made. There is no error and no warning. It returns the
wrong content and looks exactly like the right content.

This is a second, structurally different route into the same failure shape
`repo-20` already fixed once. `repo-20` closed the case where a reviewer built
before checking out, because `ticket-reviewer.md`'s setup order put the build
above the checkout. The fix there was a section reorder — order of operations,
inside one worktree, on one file the agent controls (`ticket-reviewer.md:12`
"Get the branch under review before you measure anything"). This defect needs
no misordering at all: a worktree-relative and a root-relative path can be
issued back to back, in either order, and the second one silently reads a
different tree — because the two paths are not the same tree by construction,
not because a step ran early.

**And nothing downstream tells you.** The same silent-wrong-tree shape
`dispatching.md` already documents from the other mechanism applies word for
word here. A gate read that page top to bottom on 2026-09-04 and built `main`,
`.claude/skills/orchestrate-tickets/reference/dispatching.md:157 "not the branch — catching it only because `dist/` was missing a file the branch"`,
and a reviewer measuring the base rather than the branch produces
`.claude/skills/orchestrate-tickets/reference/dispatching.md:159 "the base produces a fluent, correctly formatted gate that marks acceptance lines"`
`unproven`. A gate or a build that reads the shared root instead of the
worktree by this route has no `dist/`-shaped tell at all: it is reading source
files directly, and a file that happens to be identical between the two trees
produces no symptom whatsoever.

### Reported today, from the same batch, by two different agents

Relayed to this filing, not yet independently confirmed by me at the source —
the general mechanism is verified below instead, on a file I control:

- A `ticket-reviewer` gating repo-42's fix branch (`fix/repo-42-drop-bare-push-branch`)
  reportedly made its first several `Read`/`grep` calls with the shared-root-shaped
  absolute path while believing it was reading the branch under review, and so
  was reading `check-main-writes.sh` and `hooks.test.ts` **before** the fix. It
  is reported to have caught this only because the content read as the
  pre-fix version and it got suspicious, then confirmed with `md5sum` against
  `git cat-file -p HEAD:<path>`, which matched its worktree's on-disk file and
  not the shared root's.
- A `builder` on the same ticket reportedly did **not** hit it, and is reported
  to have said so in these words: it used worktree-relative paths throughout,
  "by luck rather than method."

If those reports are accurate, one agent caught the shadowing by suspicion and
one avoided it by habit — neither by a rule that exists anywhere in this repo.

## The reproduction

Run from this ticket's own worktree
(`/workspaces/tools/.claude/worktrees/agent-a6be81b4e496f2a7a`), against
`CLAUDE.md` — chosen because it is a real tracked file, harmless to touch and
revert, and present at an identical path in both trees.

1. Saved the committed content for comparison:

   ```
   $ git cat-file -p HEAD:CLAUDE.md | md5sum
   7e44f25cc0a6757b93f8f6eb56c239be  -
   ```

2. Appended a unique marker using the **full worktree path**:

   ```
   $ echo 'REPRODUCTION-MARKER-repo43-9f3a2b' >> /workspaces/tools/.claude/worktrees/agent-a6be81b4e496f2a7a/CLAUDE.md
   ```

3. Read the same logical file two ways and hashed both, unpiped, exit codes
   read directly rather than through a pipe:

   ```
   $ md5sum CLAUDE.md
   ea8419965a837c1a82e047184ddc557e  CLAUDE.md

   $ md5sum /workspaces/tools/CLAUDE.md
   7e44f25cc0a6757b93f8f6eb56c239be  /workspaces/tools/CLAUDE.md
   ```

   The worktree-relative read carries the marker (new hash). The
   shared-root-shaped absolute path — `/workspaces/tools/CLAUDE.md`, built the
   way an agent would build it if it (wrongly) treated `/workspaces/tools/` as
   its own repo root — returns the **unmodified** content, hash-identical to
   the committed `HEAD` version from step 1. No error, no warning, no
   difference in how the read tool reports the call.

4. Confirmed the same shadowing through the dedicated `Read` tool, not just
   `cat`/`md5sum`: `Read` on `/workspaces/tools/CLAUDE.md` returned 297 lines
   ending at "than working from memory." with no marker line — the shared
   root's copy — while the worktree's own file (`tail -3 CLAUDE.md`, relative)
   showed the marker as its last line.

5. Reverted in both steps and confirmed clean:

   ```
   $ git checkout -- CLAUDE.md
   $ git status
   On branch repo-43-worktree-path-shadowing
   Your branch is up to date with 'origin/main'.

   nothing to commit, working tree clean
   $ md5sum CLAUDE.md
   7e44f25cc0a6757b93f8f6eb56c239be  CLAUDE.md
   ```

   Matches the `HEAD` hash from step 1 exactly — the worktree is exactly as it
   was before the reproduction, and the marker round-tripped through git
   cleanly rather than lingering.

**What this establishes, precisely.** This is not a filesystem bug and not
aliasing in the usual sense — `/workspaces/tools/` and
`/workspaces/tools/.claude/worktrees/agent-.../` are two ordinary, distinct
directories, each a real git checkout, and an absolute path naming either is
unambiguous on its own terms. The defect is behavioral: an agent (or a tool
called on its behalf) that assumes `/workspaces/tools/<x>` is a stable
repo-root-relative spelling for **its own** tree is wrong the moment it is
dispatched into a nested worktree, and nothing enforces or flags that
assumption. The trap is exactly as available to a human pasting a path from a
previous session's transcript as it is to an agent.

## The decision — do not settle it here

Where the warning lives. Recommendation first.

**(a) A line in `builder.md` and `ticket-reviewer.md`, beside the sections that
already orient an agent to its own worktree.** Precedented by `repo-20`, which
put the checkout-before-build fix directly in the agent definitions rather than
leaving it to a skill's prompt clause, on the reasoning that a convention which
must hold every time belongs where it
`.claude/skills/orchestrate-tickets/reference/dispatching.md:163 "reordered that page to fetch → detach → farm → build, so the instruction"`
now loads itself into every reviewer for free, rather than in prose a caller
has to remember. The natural insertion points already exist:
`.claude/agents/builder.md:152 "## Your worktree"`, right beside the existing
`.claude/agents/builder.md:159 "Never touch `/workspaces/tools` itself"` line,
which already gestures at the shared root without saying an absolute path into
it can silently succeed; and
`.claude/agents/ticket-reviewer.md:12 "## Get the branch under review before you measure anything"`,
beside its
`.claude/agents/ticket-reviewer.md:25 "Confirm you are looking at the right tree"`
step, which currently checks branch and diff stat but not path construction.

Recommended. Cheapest of the three — one or two sentences, in a place
already read at the start of every dispatch — but it covers only these two
agent types. It does nothing for an ad-hoc subagent this skill does not
define, for the orchestrator itself working directly in a worktree, or for a
human.

**(b) A `.claude/rules/` page.** Consistent with `CLAUDE.md`'s own stated
policy — "a rule that matters in one part of the tree is a path-scoped rule in
`.claude/rules/`, which loads itself when you open a matching file" — and it
is the mechanism that costs nothing on sessions it does not apply to. It does
not obviously fit here, though, and that is worth surfacing rather than
glossing over: every existing rules page (`image-closure.md`,
`testing.md`, `toolchain-config.md`, the two `planner-*.md` pages) triggers on
a **file shape** — a test, a fixture, a `Dockerfile`, a tsconfig. This hazard
is not attached to any file shape; it is attached to _how a path is spelled_,
which can happen to any file in the tree on any read or write. A page scoped
broadly enough to fire on that (effectively `**/*`) stops being the
narrow-trigger mechanism the rules system is for and starts costing every
session regardless — which is the CLAUDE.md problem below, arrived at through
the rules mechanism instead of around it.

**(c) A `CLAUDE.md` line.** Costs every session, by design — the file's own
header says so ("this page is the one that costs every session"). Notable
because `CLAUDE.md` currently says nothing about worktrees at all (`grep -n -i
"worktree" CLAUDE.md` returns nothing), so this would be a new topic for that
file, not an extension of an existing one. Worth naming because worktree
isolation is not a niche case here — `CLAUDE.md` itself and both agent
definitions describe it as how every builder and reviewer is dispatched — but
a rule that binds only a dispatched subagent, never a plain interactive
session that never enters a worktree, sits oddly in the one file every session
pays for.

None of these is free of a real cost, and they are not mutually exclusive —
(a) alone leaves the gap named in its own paragraph; (a) plus (c) closes that
gap at the price of (c)'s per-session cost for sessions that never see a
worktree. **Do not pick one on this ticket.**

## Build

Add one or two sentences to `.claude/agents/builder.md` right after the "Never touch `/workspaces/tools` itself" paragraph (after line 160), and to `.claude/agents/ticket-reviewer.md` after the "Confirm you are looking at the right tree" step (after line 26), warning that an absolute path built from the literal prefix `/workspaces/tools/<repo-relative-path>` resolves silently to the shared root's copy of that file with no error or warning. State what to do instead: use worktree-relative paths, treating this worktree's root as the repository root.

## Done when

1. The decision above is answered on this page as a dated Log entry naming the
   option (or combination) and the reasoning, and `status` moves to `ready` in
   the same commit.
2. The reproduction above still reproduces at that time — re-run against the
   then-current tip, both hashes recorded beside (not replacing) the ones
   above, per the pattern `repo-35` uses for a re-measured reproduction.
3. Whatever is chosen is written in that same follow-up change, and
   `npm run check`, `node scripts/citations-gate.mjs`,
   `node scripts/citations-gate.mjs --against origin/main`, and
   `node scripts/status.mjs --json` all exit 0 afterward.

## Review

**Gate: PASS** — 2026-09-12 · `8d79d8e...6150b09` (origin/main...HEAD) · own defect hunt at medium (ticket-reviewer subagent, no `code-review` delegation available)

| Done when                                                                                                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision answered as dated Log entry naming option and reasoning                                                                                                                 | `docs/work/repo-43-a-worktree-nested-path-shadows-the-shared-root.md:235 "it overrode: none."` ✓ — names the question, all three options, chosen=(a), overrides none, and states the accepted (a)-alone gap in those words                                                                                                                                                                                                                         |
| Reproduction re-verified against the then-current tip, hashes recorded beside the original                                                                                       | `docs/work/repo-43-a-worktree-nested-path-shadows-the-shared-root.md:237 "worktree-relative read returned hash `d2589056e4d36a6a7f220e2e6460fa62 CLAUDE.md`; absolute path `/workspaces/tools/CLAUDE.md`"` ✓ — independently re-run by me as well: worktree-relative read after a fresh marker hashed `ed93adeecd3311bbe09b03559da6c9f7`, `/workspaces/tools/CLAUDE.md` hashed `7e44f25cc0a6757b93f8f6eb56c239be` (unmodified, matches `HEAD`)     |
| Warning written to `builder.md` and `ticket-reviewer.md` at their named insertion points; `npm run check`, both `citations-gate.mjs` invocations, and `status.mjs --json` exit 0 | `.claude/agents/builder.md:163 "resolves silently to the shared root's copy of that file"` ✓, `.claude/agents/ticket-reviewer.md:26 "resolves silently to the shared root's copy, not your worktree"` ✓ — all four commands re-run by me: `npm run check` exit 0, `node scripts/citations-gate.mjs` exit 0, `node scripts/citations-gate.mjs --against origin/main` exit 0 ("45 entr(y/ies)... 0 raised"), `node scripts/status.mjs --json` exit 0 |

- **low** · Done-when item 1 says status moves to `ready` "in the same commit" as the decision Log entry; this branch's single commit moves it straight `needs-decision` → `done`, so `ready` never appears in history. Not carried as a repair item — no rule requires the intermediate value, `done` is a strictly stronger completion signal, and every substantive requirement in items 1–3 is met. Builder agrees (message received: "the substantive work is done and that's the correct final state").
- **dropped** · considered whether the (a)-alone gap (no coverage for ad-hoc subagents, the orchestrator working directly in a worktree, or a human) was being quietly closed by this diff. It is not: `git diff --name-only 8d79d8e...HEAD` touches only `builder.md`, `ticket-reviewer.md`, and the ticket file; `CLAUDE.md` and `.claude/rules/` are untouched. Not a defect, confirms the owner's decision was honored as scoped.
- **findings** · own hunt (medium depth) returned 0 defects; 2 observations raised, both resolved as not-carried above.
- NFR: security n/a · performance n/a · reliability n/a · maintainability ✓ — small, clearly-placed prose additions, no new surface.

## Log

- **2026-09-12** — Decision answered on 2026-09-12 by the repo owner. **Question asked:** where the warning lives — that a worktree's nested path silently shadows the shared root's copy of the same file. **Options offered:** (a) a line in `builder.md` and `ticket-reviewer.md`; (b) a `.claude/rules/` page; (c) a `CLAUDE.md` line. **Chosen: (a)**, on 2026-09-12, by the repo owner. **Whose recommendation it overrode: none.** (a) is the ticket's own recommendation and the owner confirmed it. **What the answer explicitly accepts:** the ticket says (a) alone leaves the gap named in its own paragraph — it covers only these two agent types and does nothing for an ad-hoc subagent, for the orchestrator working directly in a worktree, or for a human. The owner chose (a) alone, **not** (a)+(c). This gap is knowingly accepted and not closed. Status moved to `done` in this same commit as the decision and implementation, so `ready` was never a state the ticket passed through.

  **Reproduction re-verified on 2026-09-12 against the then-current tip:** `git cat-file -p HEAD:CLAUDE.md | md5sum` returned `7e44f25cc0a6757b93f8f6eb56c239be  -` (identical to 2026-09-09); appended marker `REPRODUCTION-MARKER-repo43-2026-09-12-verify`; worktree-relative read returned hash `d2589056e4d36a6a7f220e2e6460fa62  CLAUDE.md`; absolute path `/workspaces/tools/CLAUDE.md` returned hash `7e44f25cc0a6757b93f8f6eb56c239be  /workspaces/tools/CLAUDE.md` (original, no marker); reverted with `git checkout -- CLAUDE.md` and confirmed clean.

- **2026-09-09** — Filed on branch `repo-43-worktree-path-shadowing`, base
  `origin/main` at fetch time. `node scripts/next-id.mjs repo` reported `next
free: repo-43` (clashes on `repo-16`, `repo-29`, `repo-32` — each claimed by
  merged PR#204 — resolved by the script itself, not by me).

  **The general mechanism was reproduced independently, on `CLAUDE.md`, in
  this worktree** — see `## The reproduction`. It is not a relay: every
  command in that section was run in this session and its output is quoted
  verbatim, exit codes read directly rather than through a pipe, and the
  worktree was confirmed clean (`git status`, hash matching `HEAD`) both
  before the reproduction and after reverting it.

  **The repo-42-specific pair of observations (the reviewer catching itself,
  the builder avoiding it by habit) is a relay, and is presented as one.** I
  did not enter `fix/repo-42-drop-bare-push-branch`'s worktree to confirm it
  myself — doing so would mean touching another session's worktree, which
  both this ticket's own dispatch and `builder.md:159` say to stop and report
  rather than do. The general mechanism these two reports describe is the same
  one verified above on a file I do control, which is why the reproduction
  section stands on `CLAUDE.md` rather than on repo-42's files.

  **Two things checked rather than assumed:** `git ls-remote --heads origin
repo-43-worktree-path-shadowing` returned nothing before this branch was
  pushed, and `.claude/agents/builder.md` / `.claude/agents/ticket-reviewer.md`
  currently say nothing about absolute-path shadowing under any spelling
  (`grep -n "shadow" .claude/agents/builder.md .claude/agents/ticket-reviewer.md`
  returns nothing) — so this is a new gap, not a restatement of one already
  covered elsewhere.

  **Scope held deliberately narrow.** The dispatching prompt for this ticket
  was explicit that no fix belongs on this branch, and that the agent
  definitions, `CLAUDE.md`, and any rules page are exactly the files this
  ticket must not touch — they are the subject of the decision it exists to
  raise, not files to edit while raising it. Nothing outside this one new
  ticket file was changed.
