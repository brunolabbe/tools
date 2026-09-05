---
id: repo-23
tool: repo
title: The deployment page reads as downloader-only for 286 lines before it is repo-wide
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-23 — `02-DEPLOYMENT.md` reads as downloader-only for 286 lines

**Files:** `docs/02-DEPLOYMENT.md`, and nothing else.

**Startable — no open decision.** There is one sensible remedy and it is named
below; the two alternatives were considered and are wrong, with reasons, so that
the next reader does not re-open them.

## Why

**The reproduction is an agent, not an argument.** On 2026-09-05 the gate on
[dl-32](../../tools/downloader/docs/work/dl-32-the-job-list-has-no-caller.md)
read this file and raised its location as a layout inconsistency — repo-root
`docs/` holding what it took to be one tool's content. It was reading in good
faith and it was wrong. It has since retracted, in that ticket's committed
`## Review`, as a `dropped` line naming the mistake as its own.

**What it read** — `head -30`, then `sed -n '130,150p'`. 51 lines of 530.

**What is in those 51 lines**, measured at `c37cab9`: four mentions of
`downloader` and **zero** of `planner`, and the only cross-tool link in either
window points _into_ the downloader — `docs/02-DEPLOYMENT.md:141` links
`../tools/downloader/docs/01-ARCHITECTURE.md`. `docs/02-DEPLOYMENT.md:17` gives
`https://downloader.example.com` and `docs/02-DEPLOYMENT.md:29` draws a
`downloader` container in the only architecture diagram on the page. Every
signal available in that sample pointed one way, with nothing dissenting.

**What the file actually is**, measured at `c37cab9`:

| Measured                                                    | Value                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Length                                                      | 530 lines                                                                                                                       |
| `planner`                                                   | 29 occurrences on 27 lines                                                                                                      |
| `downloader`                                                | 22 occurrences — **20 lowercase prose, plus 2 `DOWNLOADER_TAG`** at `docs/02-DEPLOYMENT.md:119` and `docs/02-DEPLOYMENT.md:267` |
| `## Grounding the planner: a routing engine and a geocoder` | `docs/02-DEPLOYMENT.md:287`–`473` — 187 lines, over a third of the file, planner only                                           |
| `## Adding the second tool`                                 | `docs/02-DEPLOYMENT.md:474` — an explicit two-tool contrast                                                                     |
| `planner` before line 287                                   | zero                                                                                                                            |

The gate's own retraction reports 20 downloader mentions where this ticket
reports 22. **Both are right**: the difference is case, and it is exactly the two
`DOWNLOADER_TAG` env-var references, which are a compose variable rather than
prose about the tool. Direction unaffected either way — planner leads on both
counts.

`docs/02-DEPLOYMENT.md:476` is the load-bearing sentence: _"The tunnel does not
change. One tunnel, one `cloudflared`, one subdomain per tool … which is why step
1 says to name the tunnel after the host and not after the downloader."_ The
page's content exists **because** there are two tools, which is root
`CLAUDE.md`'s "true of the repo" test. Its sibling is
[adr/004](../adr/004-one-compose-fragment-per-tool.md), also repo-wide
deployment, and this file already cites it at `docs/02-DEPLOYMENT.md:298`.

**So the defect is shape and ordering, and it is narrower than "the file is
confusing".** The correct framing is already written down twice —
`docs/00-TOOLS.md:51` (_"the downloader is their worked example, not their
subject"_) and `docs/adr/004-one-compose-fragment-per-tool.md:14` (_"the
downloader is their worked example rather than their subject"_) — and **never in
`02-DEPLOYMENT.md` itself**. The page opens generically once, at
`docs/02-DEPLOYMENT.md:3` (_"a tool from this repo on `<tool>.example.com`"_),
and then spends 283 lines on one tool without once saying that is what it is
doing. A reader weighs one abstract sentence against pages of concrete evidence
and believes the evidence. That is not a careless read; that is the file
teaching the wrong thing.

## The remedy, and why there is no fork

**Signpost early. Do not move the file, do not reorder it, do not split it.**
Three options were on the table; only one survives contact with the file, so this
ticket does not pose a decision.

- **Signpost (take this).** Three or four sentences before `## Shape`, saying the
  page is repo-wide and the downloader is its worked example, pointing forward to
  the planner section and to `## Adding the second tool`. Pure addition. Makes a
  third file agree with two that already say it, in their words.
- **Reorder, bringing the two-tool framing first (rejected).** `## Adding the
second tool` is written as a _delta on steps already taken_ — it says "the
  tunnel does not change" and refers back to "step 1". Moved above step 1 it is
  incoherent, and it would rewrite line numbers across the whole file, which
  `scripts/citations.mjs` resolves against for every gate record that cites it.
- **Split the planner section out (rejected, and self-defeating).** Removing
  exactly the 187-line span leaves the file **19 downloader to 12 planner** — it
  flips a page that is planner-led today (29 to 20) into a downloader-led one,
  which _manufactures_ the misreading this ticket exists to fix. The surviving
  planner mentions are all in `## Adding the second tool`, so the aggressive
  version that takes that section out too reaches **14 to 0** and manufactures it
  completely. Both endpoints reject the split, and the arithmetic is monotone
  between them. adr/004 also already settled that the deployment story is one
  story for both tools.

**The file must not move to `tools/downloader/docs/`.** That is the conclusion
this ticket exists to make unreachable, and the Build must leave the reason in
the file rather than only here — a ticket is not where the next reader looks.

## Build

1. Add the signpost to `docs/02-DEPLOYMENT.md`, above `## Shape` (currently line
   13), after the existing intro. It must:
   - use the phrase **"worked example"**, matching `docs/00-TOOLS.md:51` and
     `docs/adr/004-one-compose-fragment-per-tool.md:14` rather than inventing a
     third wording for the same idea;
   - say the page is repo-wide and why — one tunnel, one login policy, one
     version scheme, for whatever gets published;
   - point forward, by name, to `## Grounding the planner` and
     `## Adding the second tool`, so a reader who stops early knows what they
     stopped before;
   - link [adr/004](../adr/004-one-compose-fragment-per-tool.md), which this file
     already cites lower down.
2. Do not touch the `## Shape` diagram. A second container box would make the
   walkthrough's one worked example harder to follow for no gain — the signpost
   above it is what tells the reader the box is an example. Deliberately out of
   scope; say so in the Log if you disagree rather than widening.
3. Nothing else in the file changes. No heading is added, removed, renamed or
   moved.
4. `npm run format` after editing — oxfmt formats markdown here and
   `npm run check` runs `oxfmt --check`.

**Trap.** Step 1 shifts every line below it, so the `docs/02-DEPLOYMENT.md:<n>`
citations in the `## Why` above are pinned to `c37cab9` on purpose. **Do not
"correct" them to the new line numbers** — they describe the state that produced
the misreading. Check them with `--rev c37cab9`.

## Done when

1. The signpost is present and lands before `## Shape` —
   `awk '/^## Shape/{exit} /worked example/{f=1} END{exit !f}' docs/02-DEPLOYMENT.md`
   exits 0. (Exits 1 at `c37cab9`; verified red before the change.)
2. The early text points forward at the two-tool section —
   `command grep -c 'Adding the second tool' docs/02-DEPLOYMENT.md` is at least 2. (It is 1 at `c37cab9`: the heading alone.)
3. Nothing was moved or split — diffing `docs/02-DEPLOYMENT.md` against
   `origin/main` and filtering for removed headings with
   `command grep '^-## '` prints nothing and exits 1, so no heading was deleted.
4. The file is still repo-root and still repo-wide —
   `test -f docs/02-DEPLOYMENT.md && test ! -e tools/downloader/docs/02-DEPLOYMENT.md`
   exits 0, and
   `command grep -c '^## Grounding the planner' docs/02-DEPLOYMENT.md` is 1.
5. Planner still leads — `command grep -oi planner docs/02-DEPLOYMENT.md | wc -l`
   exceeds `command grep -oi downloader docs/02-DEPLOYMENT.md | wc -l`. This is
   the guard that a "fix" was not a split.
6. `npm run check` exits 0; `npm run format` leaves `git status --porcelain`
   empty; `node scripts/status.mjs --json` exits 0 with `problems: []` and
   `repo-23` at `status: done`.
7. This ticket's citations still resolve against the tree they describe —
   `node scripts/citations.mjs docs/work/repo-23-deployment-reads-as-downloader-only.md --rev c37cab9`
   reports every citation resolved.

**`grep` in this devcontainer is a bash function that silently honours ignore
files** — every check above uses `command grep` for that reason. See repo-22,
unmerged at filing time on branch `repo-file-grep-wrapper-ticket` (PR #150).
Named in prose rather than in `depends_on`: this ticket does not need it to
land first, and a `depends_on` on an id that is not on `main` makes
`node scripts/status.mjs --json` exit non-zero, which is the whole board gate in
CI.

## The gate on this filing

**This is a gate on the pull request that files repo-23 — no implementation exists yet, so its own ten-line `Done when` table is judged as future work, not as this diff's acceptance, per the `dl-29` precedent this ticket itself is modeled on.**

I checked out `26ff65ea6df40eab2982864d47fbd4aa1d07ae98` via `git fetch origin && git checkout --detach 26ff65e`. `git log --oneline -1` reports `26ff65e docs(repo): cite repo-22 and repo-24 by branch, not by depends_on (repo-23)` — matches. `git diff --stat origin/main...HEAD` reports one file, `docs/work/repo-23-deployment-reads-as-downloader-only.md`, 192 insertions — matches. `origin/main` resolves to `c37cab9`. This supersedes an earlier gate of this ticket pinned to `0c7ced5`, one commit behind; the branch moved before that gate was committed, so it was never recorded. `git diff --stat 0c7ced5 26ff65e` is one file, +14/-1: a prose reference to repo-22 (branch `repo-file-grep-wrapper-ticket`, PR #150) replacing a bare "See repo-22," plus a Log entry naming repo-24 (PR #153) as the fix for a title-quoting defect this ticket sidestepped by rewording rather than fixing.

Reviewer: Sonnet 5 (`claude-sonnet-5`), verbatim from my system prompt. Builder ran Opus (explicit `model: "opus"`). Different models, confirmed both sides.

### This diff's own acceptance (what I gated)

| Check                                                                                                                    | Result                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| File length, planner/downloader occurrence-vs-line counts                                                                | **proven** — `git show c37cab9:docs/02-DEPLOYMENT.md \| wc -l` = 530; `grep -o planner \| wc -l` = 29, `grep -c planner` = 27; `grep -oi downloader \| wc -l` = 22, `grep -o downloader \| wc -l` (case-sensitive) = 20                                            |
| The 22-vs-20 gap is exactly the two `DOWNLOADER_TAG` lines                                                               | **proven** — lines 119 and 267 are the only case-mismatch, both `` `DOWNLOADER_TAG` ``                                                                                                                                                                             |
| Section spans: `287`–`473` (187 lines, planner-only, 0 planner mentions before 287), `474` (`## Adding the second tool`) | **proven** — headings land exactly there; `sed -n '1,286p' \| grep -ci planner` = 0                                                                                                                                                                                |
| dl-32 gate's reproduction: `head -30` + `sed -n '130,150p'` = 4 downloader, 0 planner, one cross-tool link at `:141`     | **proven** — measured exactly: 2+2 downloader, 0+0 planner, `../tools/downloader/docs/01-ARCHITECTURE.md` at line 141 only                                                                                                                                         |
| The correct framing exists at `00-TOOLS.md:51` and `adr/004:14`, never in `02-DEPLOYMENT.md` itself                      | **proven** — both quotes match verbatim; `grep -n 'worked example' docs/02-DEPLOYMENT.md` at `c37cab9` returns nothing                                                                                                                                             |
| Provenance chain: dl-32's gate raised the misreading and retracted it                                                    | **verified** — `origin/dl-32-remove-job-list-route`'s copy of `tools/downloader/docs/work/dl-32-the-job-list-has-no-caller.md` carries the committed `dropped` line, at that branch's line 264, naming it "the reviewer's own error, not the builder's"            |
| "Reorder" rejection: `## Adding the second tool` is a delta on already-taken steps                                       | **verified** — full section read; refers to "step 1," contrasts against downloader specifics established earlier — incoherent moved above step 1                                                                                                                   |
| "Split" rejection: removing the 187-line planner section leaves the file "20-to-0 downloader"                            | **unproven as stated** — see finding below (this text is unchanged by the 0c7ced5→26ff65e delta)                                                                                                                                                                   |
| Superseded "below the filing bar" framing lives only in the Log                                                          | **proven** — only occurrence of "no defect, no reproduction, no decision" is in the Log, correctly framed as withdrawn                                                                                                                                             |
| `repo-23` id has no collision                                                                                            | **verified** — swept all remote branches + `gh pr list --state all`                                                                                                                                                                                                |
| Frontmatter title unquoted                                                                                               | **verified** — no quotes in frontmatter; `status.mjs --show repo-23` renders correctly                                                                                                                                                                             |
| New: `depends_on` on an unmerged id would break the board gate, so it's prose instead                                    | **verified** — injected `depends_on: ["repo-99999-does-not-exist"]` into a throwaway copy of the frontmatter; `node scripts/status.mjs --json` exits 1 with `depends_on "repo-99999-does-not-exist", which is not a ticket`; reverted, confirmed exit 0 again      |
| New: repo-22 → branch `repo-file-grep-wrapper-ticket`, PR #150; repo-24 → PR #153                                        | **proven** — `gh pr view 150`/`153` match both branch and title exactly; both branches exist (`git ls-remote --heads origin`); both cited tickets' actual content (grep-ignore-files, parseScalar-quote-stripping) matches what's referenced, not just the numbers |
| `Done when` #1 and #2 are red today                                                                                      | **verified** — unchanged by this delta, still exits 1 / returns 1                                                                                                                                                                                                  |
| `npm run check`, `npm run format`, `status.mjs --json`, `citations.mjs --rev c37cab9`, `git check-ignore` at 26ff65e     | **verified** — all exit as expected: `check` exit 0, `format` leaves tree clean, `status --json` gives `problems: []`, `citations.mjs` resolves 15/15, `check-ignore` exits 1                                                                                      |

### Findings

- **low** · The rejected "split" remedy's own number does not reproduce, unchanged by the 0c7ced5→26ff65e delta (that section wasn't touched). The ticket defines "the 187 planner lines" as the `287`–`473` span. Removing exactly that span leaves 12 planner mentions, not 0 (in `## Adding the second tool`), and drops downloader from 20 to 19, not staying at 20 (`"A downloader-only host"` at `:298` is inside the span). Repro: `git show c37cab9:docs/02-DEPLOYMENT.md | sed -n '1,286p;474,530p' | grep -oi planner | wc -l` → 12; same with `grep -o downloader` (case-sensitive) → 19. The qualitative conclusion survives regardless — 19-to-12 still flips dominance toward downloader vs. today's planner-led 20/22-to-29, so "self-defeating, don't split" stays correct; only the "0" is wrong. Your call whether to correct the sentence to 19-to-12 or leave it as rationale-only (doesn't touch Build/Done-when either way).
- **dropped** — none.
- **findings** · own defect hunt, re-run in full against 26ff65e (not just the delta): 1 returned; 1 carried, 0 dropped. Plus 2 new claims in the delta independently verified as true (not carried as findings, since they check out).

### NFRs

- security — n/a (docs-only). performance — n/a. reliability — n/a. maintainability — strong, including the two new additions: the `depends_on`-vs-prose reasoning is correct and the title-quoting Log entry correctly documents a decision that would otherwise be silently lost.

### Gate: PASS — 2026-09-05 · `origin/main...HEAD` (`c37cab9...26ff65e`) · own defect hunt, no `code-review` dispatch (no `Skill` tool)

One low finding, no med or high. PASS per the rubric.

## Log

- **2026-09-05** — Filed. Provenance, four parties, and the claim only died when
  someone read the whole file: dl-32's **gate** raised the file as misfiled
  downloader content (correctly scoping it out of its own gate); dl-32's
  **builder** refuted it with the mention counts and the section spans rather
  than letting it travel into a filed ticket; the **orchestrator** re-measured
  and confirmed the refutation; the **owner** then asked for the true observation
  to be filed underneath it; and the gate **independently retracted**, recording
  it in dl-32's `## Review` as `dropped` and as its own mistake. That chain is
  why this ticket is trustworthy, and it is the reason the reproduction is worth
  more than the fix.
- **2026-09-05** — Every measurement in `## Why` was re-run at `c37cab9` while
  filing, not copied from the relay. Two came back different from the relayed
  figures and are corrected here: the downloader count is 22 case-insensitively
  and 20 case-sensitively — the gap is precisely `DOWNLOADER_TAG` at lines 119
  and 267 — and `planner` is 29 occurrences on 27 lines, where the relay quoted
  the line count as the mention count. Neither changes the direction.
- **2026-09-05** — An earlier framing of this ticket called it below
  `CLAUDE.md`'s bar for filing — "no defect, no reproduction, no decision" — and
  that was withdrawn before filing. It has a reproduction, with a named agent,
  named commands and named line ranges, and `docs/01-TICKETS.md:32` says the
  reproduction is the deliverable. Recorded because the withdrawn framing is the
  more interesting half: the observation looked unfileable right up until the
  agent that made the mistake explained how it made it.
- **2026-09-05** — **Do not quote this ticket's `title`, and do not reword it so
  that it needs quoting.** It was first written starting with a backtick, which
  needs `title: "…"`, and `scripts/status.mjs`'s `parseScalar` returns the
  trimmed raw string without stripping quotes — so `--json` and every rendered
  view carried literal `\"` around the title. Reworded to need no quotes, which
  is a sidestep rather than a fix. The fix is repo-24, filed separately and
  unmerged at filing time (PR #153); this ticket is one of its two independent
  discoveries, and no `depends_on` links them because nothing here waits on it.
- **2026-09-05** — **The rejected "split" remedy carried a wrong number, and the
  way it was wrong is the point.** It read "20-to-0 downloader". The gate flagged
  that it does not reproduce; I accepted it and then decomposed the file, which
  showed the figure matched neither reading. All counts lowercase, against
  `c37cab9`:

  | span                                 | `downloader` | `planner` |
  | ------------------------------------ | ------------ | --------- |
  | 1–286                                | 14           | 0         |
  | 287–473, the planner section         | 1            | 17        |
  | 474–530, `## Adding the second tool` | 5            | 12        |
  | whole file                           | 20           | 29        |

  14+1+5 = 20 and 0+17+12 = 29, so the decomposition reconciles. **The "20" was
  the whole-file downloader count and the "0" was the lines-1–286 planner count
  — two different denominators in one sentence.** Corrected above to the measured
  19-to-12, with 14-to-0 named as the aggressive-split endpoint; the rejection
  gets stronger, not weaker, since no split reaches the number originally
  claimed. Recorded rather than quietly fixed because **this is the third
  instance of one error shape on this ticket**: the brief that commissioned it
  quoted 27 planner line-hits as occurrences, the dl-32 gate's retraction did the
  same, and then the ticket did it in its own rebuttal. A page about a file that
  teaches the wrong thing turns out to be easy to write wrongly in exactly its
  own way. Reproduce with
  `sed -n '1,286p;474,530p'` over `git show c37cab9:docs/02-DEPLOYMENT.md`, piped
  through `command grep -o downloader | wc -l` (19) and
  `command grep -o planner | wc -l` (12).
