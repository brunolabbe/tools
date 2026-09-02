---
id: repo-18
tool: repo
title: citations.mjs reports that a line resolves, not that it says what was claimed
kind: fix
status: ready
milestone: null
depends_on: []
---

# repo-18 — A resolved citation is not a correct one

**Packages:** `scripts` (`citations.mjs`, `test/citations.test.ts`).

## Why

`scripts/citations.mjs` exists so a record's `file:line` citations can be trusted.
It checks that the cited line **exists** at the rev. It does not check that the
line says what the citation claims — so a citation whose referent has _moved_
lands on whatever now occupies that number and is reported as **resolved**.

**This is the dominant case for a gate record, not an edge.** A record is
committed on a branch whose fix moved lines; that is what a fix does. So the tool
is at its least reliable exactly where it is most used.

It is the same failure shape as
[repo-14](./repo-14-citations-section-flag-is-a-no-op.md) — a confident wrong
answer rather than an error — and the two may be one ticket. See _Open question_.

## Reproduction

Measured on `dl-36-orchestrated`, whose fix inserted 28 lines above the code its
ticket cites. The ticket's `Done when` 4 cites `tls-origin.ts:143-149`.

```
$ git show dl-36-fixture-serial-numbers:tools/downloader/api/test/helpers/tls-origin.ts | sed -n '144,149p'
  // Defence in depth, and **not** what fixes the collision — a mutation run
  // proved it: reverting this to a constant `01` while keeping distinct common
  ...                                                    # the dl-21 comment

$ git show dab661c:tools/downloader/api/test/helpers/tls-origin.ts | sed -n '144,149p'
export async function createFixtureCertificate(names: {
  dnsNames?: readonly string[];
  ...                                # a function signature and a doc comment

$ git show dab661c:tools/downloader/api/test/helpers/tls-origin.ts | grep -n "Defence in depth"
170:  // Defence in depth, ...       # where the comment actually went
```

`node scripts/citations.mjs <ticket> --rev dab661c` reported **9/9 resolve**
throughout, with three of the nine pointing at the wrong code.

**A dangling citation would have been better.** It fails loudly; this one reads
as verified. The builder that found it judged all nine printed lines by hand and
noted that **comparing totals would have shown 9/9 at every point in that work** —
so the summary line is not merely uninformative, it is actively misleading.

### The upstream error this pairs with, worth fixing in prose either way

The citation was wrong before anything moved: the comment is exactly six lines and
the cited start `143` is `149 − 6` — an end anchor minus a length, missing the
`+1` an inclusive range needs. That diagnosis is falsifiable and was checked: had
the author cited the window they viewed through, the cited **end** would have read
151, not 149. The rule that prevents it: **cite what you read, never compute one
citation from another.** Already recorded in
[`records.md`](../../.claude/skills/orchestrate-tickets/reference/records.md).

## Build

1. **Re-run the reproduction against the tip first.** The three commands above are
   the whole of it and cost seconds. `dl-36-orchestrated` may be merged or gone by
   the time this is picked up — any branch whose fix inserted lines above a cited
   region reproduces it.
2. **Decide what "correct" means** — this is the open question below, and it
   changes the whole implementation. Do not start before it is answered.
3. **Whatever the check becomes, make the failure loud and make the summary line
   honest.** `N/N resolve` must stop being printable when a citation resolves onto
   something the citation does not describe. A count that cannot distinguish the
   two states is the defect, not the wording around it.
4. **Test it against a fixture where the referent moved**, not only against one
   where it vanished. The existing suite (`scripts/test/citations.test.ts`) covers
   dangling; this ticket is about the case where nothing dangles. Run it red first.

## Open question — do not settle it here

**How does the tool know a citation is _right_?** Three answers, with different
costs, and the choice decides the build:

- **Anchor text.** Require citations to carry a fragment of what they point at
  (`tls-origin.ts:144 "Defence in depth"`), and check the text is on the line.
  Precise, and it changes the citation _format_ — every existing record becomes
  legacy, so it needs a migration story or a two-format reader.
- **Content hash at a pinned rev.** Cheap to check, brittle to whitespace, and it
  says nothing useful when it fails ("the line changed" — into what?).
- **Report drift instead of failing.** Keep resolution as-is but additionally say
  _"this line moved between the pinned rev and HEAD"_, leaving the judgement to a
  reader. Cheapest and least protective; it would have caught this instance.

**A lean, not a decision:** the third is the smallest change that would have
surfaced this case, and it does not invalidate a single existing citation. The
first is the only one that actually verifies the claim.

## Also here, and not this ticket's job

[dl-30](../../tools/downloader/docs/work/dl-30-measure-a-rendition.md)'s Log says
"See the Review section for why…" and the file has **no `## Review` heading at
all** — a merged ticket pointing at a section that does not exist. Noticed while
sampling for this reproduction. It is the same family (a reference nothing
validates) and it is a separate fix; file it or fold it, but do not let it ride
along here.

## Done when

1. A citation whose referent has moved is reported differently from one that
   still points at what it claims — proven by a test using a fixture where lines
   were inserted above the cited region, not one where the file was deleted.
2. That test failed before the change. Say so, with the output.
3. The summary line cannot read `N/N` while any citation is in the moved state.
4. The open question is recorded on this ticket with its answer and its reason,
   and if the answer changes the citation format, the migration story is written
   down before any record is rewritten.
5. `npm run check` and `npx vitest run scripts` pass.

## Log

- **2026-09-02** — Filed off `origin/main@7fe18af`. Found by a builder during an
  orchestrated run of `dl-36`, which was told to run `citations.mjs` before
  committing its gate record and judged the nine printed lines individually rather
  than reading the total. Reproduced independently here, and again by that run's
  reviewer, which re-derived the post-fix line numbers (169 / 170-175 / 176 / 177)
  from the file without prompting.

  **Not fixed here, and the reason is the open question**: "resolves" and "is
  correct" need a definition before a check can exist, and all three candidate
  definitions have real costs — one of them invalidates the format every existing
  record uses. Filing without settling it would hand the next agent a build step
  it cannot start.

  `repo-18` confirmed free against both lists: `docs/work/` tops out at `repo-17`,
  a grep over the tree adds only `repo-404`, `repo-808`, `repo-901` and `repo-999`
  (all `scripts/status.mjs` fixtures), and no remote branch or pull request in any
  state names it.
