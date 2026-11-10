---
id: dl-137
tool: downloader
title: An unbroken page title or error message widens the page past the screen
kind: fix
status: ready
milestone: null
depends_on: [dl-133]
difficulty: standard
---

# dl-137 — An unbroken page title or error message widens the page past the screen

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
- **The error notice's message**, `p.notice__message` in
  `web/src/components/ErrorPanel.tsx` (`{view.message}`), widened into this
  ticket by the owner on 2026-11-10 (Decision, question 3). It is a paragraph,
  not a heading, and `.notice__message` sets a margin and nothing else. A failed
  job's `error.message` reaches it. **No live call site was found that puts
  outside text in that message** (gate 1 read the AppError sites in
  `ytdlp.ts`: they pass `undefined` as the message and put outside text in
  `details`), but 138 AppError sites exist and only that file was read, so the
  search is not exhaustive. The case is reached from storage, as the third
  reading above is.
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

**The error message's reading** is gate 1's, not this filing's: its case `GX-a`
in `dl137-gate-extra.spec.ts` (gate 1's scratch, not committed) seeds
`downloader:jobs:v1` with a failed job whose `error.message` is 200 unbroken
characters (`"M".repeat(200)`), a short heading, and reads the page at both
widths, **with `overflow-wrap: anywhere` planted on `.card__title` and
`.job__title` and nowhere else**, so the headings cannot be what widens it:

| Reading                                         | 360 px window | 1280 px window |
| ----------------------------------------------- | ------------- | -------------- |
| failed job, 200-character `error.message`       | 2522          | 2675           |
| the same job, a short message (gate's `GX-ctl`) | 360           | 1280           |

It was measured against dl-133's head `4c621dc8` with the plant in, not on
`main`. `ErrorPanel` renders `.notice__message` on both (`ErrorPanel.tsx`,
line 37), but the figure is gate 1's and this ticket did not re-run it.

## Build

1. **Start from `main` after dl-133 has merged** (the owner's answer A,
   2026-11-10; `depends_on: [dl-133]`). The stylesheet to edit is then dl-133's:
   `.job__title` no longer exists and `.card__title` is the one heading class.
   If dl-133 has not merged, stop and say so; do not fix `main`'s two rules.
2. Add `overflow-wrap: anywhere` to **two** rules in `web/src/styles.css`:
   `.card__title` and `.notice__message`, as `.url-echo` and `.job__subtitle`
   already carry it. Check that the box around each can shrink: `.job__titles`
   has `min-width: 0`; read `.card__headline` and the `.card__head` row, and the
   notice's own container, for the same, since a flex child that cannot shrink
   defeats the declaration. Do not put `overflow-x: hidden` on anything that
   wraps the page (`responsive-layout.md`).
3. **Four cases** in `e2e/layout.spec.ts`, in the same pull request, each
   measured at 360 and at 1280 px through the file's `fitsBothWidths`, each with
   a 200-character string with no spaces (the file's existing cases keep the
   long address):
   1. the analysis box's heading (`h2.card__title`), the probe's answer rewritten
      by `page.route` to carry the title;
   2. a running job box's heading, the same title, reached through a delayed
      origin (`startDelayingProxy`) so the job is still `downloading`;
   3. a restored job's heading when it falls back to its address: a failed job
      seeded in `localStorage` with `variant: null`, an unbroken `sourceUrl` and
      no `downloader:titles:v1` entry;
   4. a restored failed job's `p.notice__message`: the same seed with a short
      heading and a 200-character `error.message`.

   Beside the width reading, each case asserts that the string is **whole and
   wrapped, not cut**: the element's text equals the string, and its box is
   taller than one line (its height exceeds 1.5 times its computed
   `line-height`) with its right edge inside `innerWidth`. A heading clipped to
   a letter would pass the width reading alone. **Open the screenshots**.

4. A fifth, short case for the clause "a title with spaces still wraps at
   them": a heading of forty five-letter words separated by spaces at 360 px is
   taller than one line, its text equals the string, and `scrollWidth` is at
   most `innerWidth`.
5. Run the new cases **before** the fix and see the four unbroken ones red at
   both widths, then green; the fifth is green on both sides.

## Decision — answered 2026-11-10 by the owner

**Question 1, where the fix goes — answered 2026-11-10 by the owner: A.** The
options were A (its own pull request on dl-133's `.card__title`, after dl-133
merges), B (fold it into dl-135) and C (fix it on `main` now). The owner chose A,
the recommendation below. `depends_on: [dl-133]` and `status: ready` are set in
the commit that records it, as the last paragraph of this section said.

**Question 2, the gate's text findings F1, F2 and F3 — answered 2026-11-10 by
the owner: fix all.** The options were fix all in this round or record them
only. They are fixed in the commit after this one, and the Log says how.

**Question 3, gate 1's F4 (`.notice__message`) — answered 2026-11-10 by the
owner: widen dl-137.** The options were: widen this ticket to
`.notice__message`; file it separately; record it only. This ticket's Build and
Done when now also cover `.notice__message` with the same declaration, checked
by the same shape of layout case. The widened Build and Done when are written
in the commit after this one; the Why records F4's reproduction.

The question as it stood when filed, and the options with their costs as the
filing put them (the costs are corrected in the commit after this one, F1 and
F2):

Which branch's stylesheet the fix targets, and whether it belongs in dl-135.
Three branches are live around the same two rules, and the declaration lands in
one of them. Facts that decide it:

- **dl-133** (PR #781, in review; head `dfdc5258` when filed, `4c621dc8` when
  gate 1 measured, the claims here hold at both) deletes `.job__title` and
  draws the heading as `h2.card__title` for the analysis and for the job it
  becomes, in one new component (`BoxHead`). After it merges there is one heading
  class to fix, not two.
- **dl-135** (`ready`, **has not started**: on 2026-11-10 `origin` holds no
  dl-135 branch and no open pull request names it) rewrites `styles.css`, and its
  Build step 4 edits `.card__title` itself (font size to the base's `1.125rem`,
  the rule kept local). Its Done when lines are about the reset: none mentions
  overflow, and its screenshot comparison is of the reset, not of a long title.
  Its `depends_on` names repo-130 only, and neither ticket mentions the other, so
  that dl-135 follows dl-133 is an order the orchestration chose, not one the
  tree records.
- The defect is on `main` now and does not depend on either.

**Options**

- **A. A separate pull request on dl-133's stylesheet, after dl-133 merges.**
  Set `depends_on: [dl-133]` here. One declaration on `.card__title` and the
  layout case, in a branch of its own, cut from `main` once dl-133 is in.
  Cost: waits for dl-133's merge. Against dl-135 the cost is zero if A merges
  before dl-135 starts, and a merge conflict on a few lines of `.card__title` if
  dl-135 starts first, since its step 4 edits the same rule.
- **B. Fold it into dl-135.** The owner adds a Build step and a Done when line to
  dl-135, recorded there as an owner's answer. Cost: dl-135's own page calls it
  the most restructuring of the three tools' moves onto the shared base, and it
  is gated on screenshots of the reset; a defect with its own reproduction rides
  on a branch that is judged on something else, and ships only when that branch
  does. The fix is not something the reset touches (the base has no
  `overflow-wrap`; only `chrome.css` does), so nothing makes it cheaper there.
- **C. Fix it on `main` now, against `.job__title` and `.card__title` as they
  stand.** Ships first and is not held by dl-133. Cost, measured by gate 1 with
  `git merge-tree --write-tree` of scratch commits on `a100f429` against #781's
  head `4c621dc8`: **two files conflict, not one.**
  - `styles.css`: the fix on both `.card__title` and `.job__title` conflicts in
    one hunk, the `.job__title` rule #781 deletes (exit 1). On `.card__title`
    alone it merges clean (exit 0).
  - `e2e/layout.spec.ts`: Build step 3's case, appended at the end of the file,
    conflicts (exit 1), because #781 appends 129 lines there; the
    `startDelayingProxy` import edit alone merges clean (exit 0), since #781
    makes the identical edit.

  So C costs a merge of `main` into #781 (already gated once) and a gate's
  attention to a hunk in its own new tests, not only to a stylesheet rule it
  deleted. (Gate 1 also measured, as a fact and not a recommendation:
  `overflow-wrap: anywhere` on `.job__titles`, the parent of both heading
  elements on `main` and of `BoxHead`'s heading on #781, merges clean with #781.
  Whether it fixes the width by inheritance was **not run**.)

**Recommendation: A**, on dl-133's `.card__title`, as its own pull request,
outside dl-135's scope. It is the only option that touches the stylesheet once,
leaves dl-133's gated diff alone, and keeps dl-135's Done when lines about what
they were written for. If the owner wants the defect closed before dl-133 lands,
C is the option, accepting the conflict on #781.

If the answer is A, set `depends_on: [dl-133]` and `status: ready` in the
commit that records it. If B, add the step to dl-135 in the same commit and mark
this ticket `dropped` with the reason. If C, `depends_on` stays empty.

## Done when

1. `web/src/styles.css` carries `overflow-wrap: anywhere` on `.card__title` and
   on `.notice__message`, and on no wrapper of the page.
2. Each of **four elements** reads `scrollWidth <= innerWidth` at 360 and at
   1280 px with a 200-character string that has no spaces, each in its own
   `e2e/layout.spec.ts` case (Build 3): the analysis box's heading
   (`h2.card__title`), a running job box's heading (`h2.card__title`), a
   restored job's address-as-heading (`h2.card__title`), and a restored failed
   job's `p.notice__message`.
3. In each of the four, the element's text equals the whole string and its box
   is taller than one line with its right edge inside `innerWidth` (the string
   is wrapped, not cut), and the Log attaches the four screenshots, opened and
   described.
4. The clause "a title with spaces still wraps at them" is the fifth case
   (Build 4), green before and after the fix, and the file's other cases are
   green as before.
5. The four unbroken cases fail on the fix's base at both widths and pass after
   it: `E2E_PORT=<free port> npm run e2e:downloader -- tools/downloader/e2e/layout.spec.ts`,
   the failing and passing output in the Log.
6. `npm run check` and `npm test -- --project downloader` pass.

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
- **2026-11-10, round 1** after gate 1 (Sonnet 5.5, narrow, at `c8938c67`,
  CONCERNS; its plant of `overflow-wrap: anywhere` on both heading rules turned
  all three title cases green). The owner's three answers are under _Decision_,
  in `b5b335b3`; this entry's commit carries the text they imply:
  - **F1 fixed.** Option C now carries gate 1's `git merge-tree` figures: two
    files conflict (`styles.css` on the `.job__title` hunk, `e2e/layout.spec.ts`
    on an appended case), not one.
  - **F2 fixed.** "Queued behind dl-133" became "has not started", with the
    facts that make it so (no dl-135 branch or pull request on `origin`, its
    `depends_on` is `[repo-130]`, neither ticket names the other); A's cost
    against dl-135 is zero unless dl-135 starts first. "The largest
    restructuring in the tool" became dl-135's own words, "the most
    restructuring" of the three tools' moves.
  - **F3 fixed.** Done when 2 and Build 3 now name the same four elements. The
    "still wraps at them" clause has its own case (Build 4, Done when 4); each
    unbroken case also asserts the string is whole and wrapped, not cut
    (Done when 3), since a heading cut to a letter passes the width reading.
  - **F4 widened in**, on the owner's answer: `.notice__message` joins Build 2,
    Done when 1 to 3, the title, and the reproduction (gate 1's `GX-a`: 2522 px at
    360, 2675 px at 1280, with the heading plant in). That figure is gate 1's,
    measured on dl-133's head; this ticket did not re-run it.
  - **`difficulty` stays `standard`.** The widening adds one declaration and one
    case shape to the same two-rule fix; the judgement is in the four reachable
    states, which the Build spells out, so it is a test and a stylesheet inside
    one package with its method stated, the format's own example of `standard`.
  - The filename keeps its `title` slug; the pull request title still says
    "page title", and the squash message is the owner's to widen if wanted.
