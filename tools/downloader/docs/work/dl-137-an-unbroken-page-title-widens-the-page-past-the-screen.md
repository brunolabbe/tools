---
id: dl-137
tool: downloader
title: An unbroken page title widens the page past the screen
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# dl-137 — An unbroken page title widens the page past the screen

## Why

Found by dl-133's first gate (Sonnet 5.5, at dl-133's head `dfdc5258`, branch
`downloader/dl-133-one-box-per-analysis`, PR #781) as a finding the diff did not
cause, and filed on the owner's choice on 2026-11-10. The gate's words:

> **low** · **F4** · Pre-existing and outside the diff's reach, recorded for a
> ticket: a heading with no break points breaks the page. A 200-character
> unbroken title gives `scrollWidth` 1706 at 360 px and 1858 at 1280 px.
> `.card__title` carries no `overflow-wrap`; the base's `.job__title` carried
> none either (the base stylesheet set it only on `.url-echo`, `.job__subtitle`,
> `.result__filename`), and a restored job with no stored title falls back to the
> full address as its heading. The base was not run: unmeasured.

The gate did not run `main`. This ticket did, and the defect is on `main`.

The rule it breaks is `.claude/rules/responsive-layout.md`: no page scrolls
sideways, `document.documentElement.scrollWidth <= window.innerWidth`, at 360 px
and at a desktop width. `e2e/layout.spec.ts` carries a long **address** on
purpose (the `longUrl()` helper, whose comment says why) and never a long
**title**, so the heading is the one place a string with no break points reaches
the page unguarded.

### Where a heading can be unbroken, on `main` at `a100f429`

- **The probe panel's heading**, `h2.card__title` in
  `web/src/components/ProbePanel.tsx`, shows `probe.title`: the page's own
  `<title>`, which the resolver passes through and a site chooses.
- **The job card's heading**, `h3.job__title` in `web/src/components/JobCard.tsx`:
  `const heading = title ?? job.variant?.label ?? job.sourceUrl;`. The title is
  the one the visitor saw at Download, kept beside the job list under
  `downloader:titles:v1` (`web/src/lib/job-store.ts`, `loadTitles`/`saveTitles`).
  **The address fallback exists on main**, in that one line. It is reached when
  a restored job has no stored title **and** no `variant`: the title map is
  pruned to jobs the list still keeps, and a job record can carry
  `variant: null` (`jobSchema`, `variant: mediaVariantSchema.nullable()`). A job
  with a variant falls back to the variant's label, which is short.
- Not measured: `.notice__title`, `.offer__title`, `.scenario__title`. They hold
  copy this repo writes, not a page's text, so they were not tried.

`.card__title` and `.job__title` (`web/src/styles.css`) set a margin and a font
size and nothing else. The neighbours that do break (`.url-echo`,
`.job__subtitle`, `.result__filename`) carry `overflow-wrap: anywhere`.
`packages/ui/src/base.css` sets no `overflow-wrap` either, so dl-135's reset onto
it does not repair this.

### Reproduction, on `main`

A throwaway spec (kept in the builder's scratch directory, not committed)
gives three headings a string with no break points and reads `scrollWidth`
against `innerWidth` at 360 and at 1280 px, after each is on screen:

1. the probe panel, with `/api/probe`'s answer rewritten to a 200-character
   title (`"T".repeat(200)`);
2. a running job card (a delayed segment origin keeps it in `downloading`),
   same title, `.job__title` read back to equal it;
3. a restored job: `downloader:jobs:v1` seeded in `localStorage` with a failed
   job, `variant: null`, `sourceUrl` an address of about 230 characters, and no
   `downloader:titles:v1` entry, so `.job__title` reads back as the address.

```
E2E_PORT=8137 npm run e2e:downloader -- tools/downloader/e2e/dl137-unbroken-title.spec.ts
```

(the spec copied into `e2e/` for the run and removed after). Each `scrollWidth`
below is the page, in a window of `innerWidth`:

| Heading                                                 | 360 px window | 1280 px window |
| ------------------------------------------------------- | ------------- | -------------- |
| probe panel, 200-character title                        | 1846          | 1998           |
| running job card, 200-character title                   | 1706          | 1858           |
| restored job, address as heading (about 230 characters) | 1787          | 1940           |

```
  3 failed
    Error: job-card-titled @360
    Expected: <= 360
    Received:    1706
    Error: job-card-titled @1280
    Expected: <= 1280
    Received:    1858
```

The job card's 1706 and 1858 are the gate's numbers to the pixel, so the
dl-133 branch did not move them: the same figure on `main` and on its head. The
other four failing readings are of the same shape (the page is the width of one
unbroken line).

**The control, same spec, same commands**, with a short title
(`"A short title"`) and an address without its long query: `3 passed`, and all
six readings equal the window (`scrollWidth=360 innerWidth=360`,
`scrollWidth=1280 innerWidth=1280`). So the width comes from the heading, not
from the spec's route, the seeded storage or the delayed origin.

## Build

1. **Choose the stylesheet first** (the Decision below), because the fix is a
   declaration in a rule that two sibling tickets both rewrite.
2. Let a heading break anywhere when it has to: `overflow-wrap: anywhere` on the
   heading class the chosen branch carries (`.card__title`, and `.job__title`
   while it exists), as `.url-echo` and `.job__subtitle` already do. Check that
   the box around it can shrink: `.job__titles` has `min-width: 0`; read
   `.card__headline` and the `.card__head` row for the same, since a flex child
   that cannot shrink defeats the declaration. Do not put `overflow-x: hidden`
   on anything that wraps the page (`responsive-layout.md`).
3. A case in `e2e/layout.spec.ts`, in the same pull request, that gives the probe
   panel's heading and the job card's a 200-character title with no spaces, and
   measures both at 360 and 1280 px through the file's `fitsBothWidths`. For the
   job card, prefer reaching it as the three readings above do: a delayed origin
   (`startDelayingProxy`) for a running one, a seeded `localStorage` for the
   address-as-heading one. **Open the screenshots**: the title must be readable,
   wrapped, not clipped.
4. Run the new case **before** the fix and see it red at both widths, then green.

## Decision — open

Which branch's stylesheet the fix targets, and whether it belongs in dl-135.
Three branches are live around the same two rules, and the declaration lands in
one of them. Facts that decide it:

- **dl-133** (PR #781, in review, head `dfdc5258`) deletes `.job__title` and
  draws the heading as `h2.card__title` for the analysis and for the job it
  becomes, in one new component (`BoxHead`). After it merges there is one heading
  class to fix, not two.
- **dl-135** (`ready`, queued behind dl-133) rewrites `styles.css`, and its Build
  step 4 edits `.card__title` itself (font size to the base's `1.125rem`, the
  rule kept local). Its Done when lines are about the reset: none mentions
  overflow, and its screenshot comparison is of the reset, not of a long title.
  `depends_on` of dl-135 names repo-130 only.
- The defect is on `main` now and does not depend on either.

**Options**

- **A. A separate pull request on dl-133's stylesheet, after dl-133 merges.**
  Set `depends_on: [dl-133]` here. One declaration on `.card__title` and the
  layout case, in a branch of its own, cut from `main` once dl-133 is in.
  Cost: waits for dl-133's merge. It also lands before dl-135 starts or is
  re-merged, so dl-135 meets the declaration in the rule it is already editing;
  a merge conflict on those few lines is the cost, and small.
- **B. Fold it into dl-135.** The owner adds a Build step and a Done when line to
  dl-135, recorded there as an owner's answer. Cost: dl-135 is the largest
  restructuring in the tool and is gated on screenshots of the reset; a
  defect with its own reproduction rides on a branch that is judged on
  something else, and ships only when that branch does. The fix is not
  something the reset touches (the base has no `overflow-wrap`), so nothing
  makes it cheaper there.
- **C. Fix it on `main` now, against `.job__title` and `.card__title` as they
  stand.** Ships first and is not held by dl-133. Cost: dl-133 deletes
  `.job__title` and edits the stylesheet's `.card__title` neighbourhood, so one
  of the two branches takes a conflict in `styles.css`, and #781 (already gated
  once) would need a merge of `main` and its own gate's attention to a hunk it did
  not write.

**Recommendation: A**, on dl-133's `.card__title`, as its own pull request,
outside dl-135's scope. It is the only option that touches the stylesheet once,
leaves dl-133's gated diff alone, and keeps dl-135's Done when lines about what
they were written for. If the owner wants the defect closed before dl-133 lands,
C is the option, accepting the conflict on #781.

If the answer is A, set `depends_on: [dl-133]` and `status: ready` in the
commit that records it. If B, add the step to dl-135 in the same commit and mark
this ticket `dropped` with the reason. If C, `depends_on` stays empty.

## Done when

1. The new `e2e/layout.spec.ts` case fails on the base of the fix's branch at
   both widths and passes after it: `E2E_PORT=<free port> npm run
   e2e:downloader -- tools/downloader/e2e/layout.spec.ts`, with the failing and
   passing output in the Log.
2. The probe panel's heading, a running job card's heading and a restored job's
   address-as-heading each read `scrollWidth <= innerWidth` at 360 and at
   1280 px with a 200-character unbroken string, and the Log attaches the
   screenshots of the three, opened and described.
3. A title that has spaces still wraps at them: the layout spec's other cases
   and a short title (the control above) read as before.
4. `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-11-10, filed** from dl-133's gate 1, F4 (Sonnet 5.5, dl-133's head
  `dfdc5258`, PR #781), on the owner's choice to file it. Reproduced on `main`
  at `a100f429` before filing: the throwaway spec, its command and its readings
  are under _Why_, with the control. The gate's own e2e probe was read for its
  shape only. What the gate had right: both numbers for the titled job card,
  `1706` and `1858`. What it had unmeasured and this found: the failure is
  already on `main` (the gate read only the stylesheet), the probe panel's
  heading fails too, and the address fallback is real on `main` but is reached
  only by a job with no stored title **and** no variant.
