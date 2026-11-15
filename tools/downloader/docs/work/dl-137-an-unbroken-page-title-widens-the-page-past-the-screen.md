---
id: dl-137
tool: downloader
title: An unbroken page title or error message widens the page past the screen
kind: fix
status: done
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
- **The job card's heading** (on `main` at `a100f429` `h3.job__title`; since dl-133 the
  same `h2.card__title` the analysis uses, drawn by `BoxHead`), in
  `web/src/components/JobCard.tsx`:
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
  `details`), but 156 `new AppError(` sites exist under `tools/downloader` (tests and
  docs excluded) and only that file was read, so the
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

Gate 1 measured this on `main`'s code (`c8938c67`, the ticket-only branch),
twice, with the plant in and without it: 2522 / 2675 both times.
`ErrorPanel.tsx`, `error-presentation.ts` and the `.notice__message` rule are
unchanged on dl-133's head, which was read, not run.

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
   `line-height`, read with `getComputedStyle` as a pixel value: the shared
   base sets `1.55`, so it computes to a pixel value on these elements, and
   the brief's `font-size` bound and its claim that `line-height` reads
   `normal` were wrong, see the 2026-11-15 Log entry) with its right edge
   inside `innerWidth` and the text not running past the element's own box. A heading clipped to a letter would pass the width
   reading alone. **Open the screenshots**.

   `h2.card__title` is not unique on the page the cases reach: the "Analyse a
   page" form heading in `App.tsx` carries the class beside every box heading
   (`ScenarioHints` does too, under the mock API only), and Playwright's strict
   mode refuses `toHaveText` on a locator that matches more than one element.
   Scope each locator by role and name, or by the box it sits in.

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
only. They are fixed in round 1, and the Log says how.

**Question 3, gate 1's F4 (`.notice__message`) — answered 2026-11-10 by the
owner: widen dl-137.** The options were: widen this ticket to
`.notice__message`; file it separately; record it only. This ticket's Build and
Done when now also cover `.notice__message` with the same declaration, checked
by the same shape of layout case. The widened Build and Done when are written
in round 1; the Why records F4's reproduction.

**Question 4, gate 1's F1 on the built head (an unbroken subtitle language in the
"Embed subtitles" label) — answered 2026-11-15 by the owner: fold it in, over
the gate's recommendation to file.** The options were (1) file a ticket, the
gate's recommendation; (2) fold it into dl-137 as one CSS rule and one layout
case, then a narrow gate 2; (3) record only. The owner chose (2) and so
overrode the gate's recommendation. The gate's finding: a 200-character
unbroken `language` in `probe.subtitles` reaches the label
`Embed subtitles (…)` in `ProbePanel.tsx` (`.options__row label`,
`display: inline-flex`, no `overflow-wrap`) and reads `scrollWidth` 1875 at 360
px and 2028 at 1280 px, the same on the base and on the head 8f64987c; a remote
manifest controls the value (`resolvers/src/manifest/hls.ts` copies the
`LANGUAGE` attribute as it is). **Scope: this ticket now also covers that one
label, with one rule and one case appended to `e2e/layout.spec.ts`.** The
`Done when` lines above are unchanged and still describe the four elements.
Also answered the same day: F2 and F3 of the same gate (a code comment and two
Log descriptions that misstate what the screenshots show) are fixed in this
round.

**Question 5, the builder's open decision on the subtitle label's checkbox —
answered 2026-11-15 by the owner: A, leave it centred.** When a long language
list wraps, the checkbox stays vertically centred on the whole wrapped block
(`align-items: center` on `.options__row label`), not on its first line. The
options were (A) leave it centred, the builder's recommendation, as built; (B)
`align-items: baseline`, which puts the box on the first line and shifts the
other option labels by a pixel or two, at the cost of a fixer round and a narrow
gate 3. The owner chose A. No recommendation was overridden.

**Question 6, gate 2's N1 (low) — answered 2026-11-15 by the owner: (1), record
only.** The subtitle case's "taller than one and a half lines" clause also
passes without the fix, because the unfixed label already breaks once at the
space before the bracket; the case still goes red without the fix through its
width and right-edge checks. The options were (1) record only, the
orchestrator's recommendation; (2) tighten the assertion, with a narrow
re-gate. The owner chose (1). The finding stays in gate 2's record as written,
unfixed. No recommendation was overridden.

The question as it stood when filed, and the options with their costs as the
filing put them (the costs are corrected in round 1, F1 and
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
    conflicts (exit 1), because #781 appends 126 lines there (132 in all); the
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

## Review

**Gate: PASS** — 2026-11-15 · `4e040577..8f64987c` · Opus 5.5, depth full

| Done when                                                                                                              | Proof                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. `overflow-wrap: anywhere` on `.card__title` and `.notice__message`, on no wrapper                                   | **verified** — the diff of `web/src/styles.css` adds exactly those two declarations and nothing else; the built CSS counts 6 `overflow-wrap:anywhere` on the head, 4 on the base stylesheet                                                                                                                                                                                                                  |
| 2. Four elements fit at 360 and 1280 with a 200-character unbroken string, each its own case                           | `e2e/layout.spec.ts` › "an unbroken page title in the analysis box's heading wraps (dl-137)", "an unbroken page title in a running job's heading wraps (dl-137)", "a restored job's address as its heading wraps (dl-137)", "a restored job's unbroken error message wraps (dl-137)": `fitsBothWidths`' `scrollWidth <= innerWidth` ✓ — CI `e2e (direct)` (downloader) success at `8f64987c`; local 14 of 14 |
| 3. Text equals the string, taller than one line, right edge inside `innerWidth`; Log describes four opened screenshots | the same four cases, `wrapsWhole`: `toHaveText`, height > 1.5 × computed `line-height` (26.04 px), `right <= innerWidth`, `scrollWidth - clientWidth <= 0` ✓ (CI as above). Screenshot clause **verified** by reading the Log, with two descriptions wrong (low below)                                                                                                                                       |
| 4. Spaced-title case green before and after; the file's other cases green                                              | **verified** — "a title with spaces still wraps at them (dl-137)" and the nine older cases pass on the base stylesheet and on the head (10 of 14 and 14 of 14)                                                                                                                                                                                                                                               |
| 5. The four unbroken cases fail on the base at both widths, pass after                                                 | **verified** — base stylesheet in the head tree: `4 failed, 10 passed`, each at both widths, readings 1846/1998, 1846/1998, 2091/2243, 2505/2658 px, equal to the Log's; head `14 passed`                                                                                                                                                                                                                    |
| 6. `npm run check` and `npm test -- --project downloader` pass                                                         | **verified** — check exit 0; 2622 passed, 2 skipped of 2624 (127 of 128 files, 1 skipped)                                                                                                                                                                                                                                                                                                                    |

- **Positive controls:** `overflow-wrap` removed from `.notice__message` alone turns only the error-message case red, at both widths, on the width, height and overflow assertions, and the three title cases stay green. Removed from `.card__title` alone, it turns the three title cases red the same way and leaves the message case green. `right edge inside the window` failed in neither control: the overflow assertion carries that part of the clause.
- **low** · F1 · no `Done when` line depends on it · on `main` already, not caused by this branch: a subtitle track's language widens the page. A 200-character unbroken `language` in `probe.subtitles` reaches the "Embed subtitles (…)" label in `ProbePanel.tsx` (`.options__row label`, `display: inline-flex`, no `overflow-wrap`). It reads `scrollWidth` 1875 at 360 px and 2028 at 1280 px, the same on the base and on the head. A remote manifest controls the value: `resolvers/src/manifest/hls.ts` copies the subtitle rendition's `LANGUAGE` attribute as it is. It is outside the four elements the owner chose (open decision in the report).
- **low** · F2 · `nfr:maintainability` · the running-job case's comment says the job is "still downloading while it is measured". The head's screenshot `Unbroken title, running job-1280.png` shows `Re-analysing` (`probing`), 0 B. That is false in the safe direction, because every active status draws the same `BoxHead` heading.
- **low** · F3 · the Log's screenshot descriptions are partly wrong: the running job's title sits **above** the `Re-analysing` pill, not under it. The restored job's address takes seven lines at 360 px, not six. Both are false in the safe direction, because the assertions do not rest on them.
- **dropped** · rendition label, video codec, audio codec and language cells at 200 characters: the page stays at 360 and 1280 px. `.tablewrap`'s `overflow-x: auto` holds the table, at a `scrollWidth` of up to 2271 px, inside its own scroller. That is the table's design, not a page scroll.
- **dropped** · `wrapsWhole`'s right-edge assertion never goes red, even on the base. Not a defect: the Log says so itself, and the overflow assertion catches a cut string.
- **findings** · the hunt returned 5; 3 carried, 2 dropped.
- NFR: security n/a (CSS and a test) · performance n/a · reliability ✓ (no base/head change in 242 element boxes over 16 state-widths of ordinary text) · maintainability — F2.

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
  all three title cases green). The owner's three answers are under _Decision_;
  this entry carries the text they imply:
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
    360, 2675 px at 1280, with the heading plant in). That figure is gate 1's
    reading on `main`'s code.
  - **`difficulty` stays `standard`.** The widening adds one declaration and one
    case shape to the same two-rule fix; the judgement is in the four reachable
    states, which the Build spells out, so it is a test and a stylesheet inside
    one package with its method stated, the format's own example of `standard`.
  - The filename keeps its `title` slug; the pull request title still says
    "page title", and the squash message is the owner's to widen if wanted.
- 2026-11-10 — Owner's answers at the landing (relayed by the orchestrator):
  gate 2's F5 to F9 were **fixed at landing, all five, with no re-gate** (the
  options were fix all, F5 to F7 only, record all); and the pull request is
  **retitled** to `docs(downloader): file dl-137, an unbroken title or error
  message overflows the page (dl-137)` (the options were retitle or leave it; the
  owner chose to retitle, overriding the filer's "leave it"). This supersedes the
  last bullet of the round 1 entry above, which says the title still reads "page
  title". Gate 2's `unproven (scope)` row asked which options the owner was shown
  for questions 2 and 3: the orchestrator checked, and the options recorded under
  _Decision_ match those put to the owner in substance, so nothing changes there.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, F5 — "the F4 reading is
  attributed to the wrong tree". The sentence under the reproduction's second
  table and the round 1 entry now say gate 1 read `main`'s code (`c8938c67`).
  `git diff bf72d130 HEAD -- <this ticket> | grep -c '^-.*It was measured against'`
  → `1`, and `... | grep -c '^-.*measured on dl'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, F6 — "Build 3's 1.5
  times its computed line-height is not a number here". Build 3 now reads the
  heading's height against 1.5 times its computed font size.
  `git diff bf72d130 HEAD -- <this ticket> | grep -c '^-.*with its right edge inside'`
  → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, F7 — "the heading
  selector is not a unique locator on the page the cases reach". Build 3 now says
  to scope each locator by role and name or by its box.
  `git diff bf72d130 HEAD -- <this ticket> | grep -v 'Fixed at landing' | grep -c '^+.*is not unique on the page the cases reach'`
  → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, F8 — "two figures the
  round carries do not reproduce". Option C's "129 lines" is now 126 (132 in all),
  and the Why's "138" AppError sites is 156 `new AppError(` sites under
  `tools/downloader`, tests and docs excluded (counted at landing: 156; the
  `layout.spec.ts` diff between `a100f429` and `4c621dc8` is 132 added, 5 removed).
  `git diff bf72d130 HEAD -- <this ticket> | grep -c '^-.*appends 129 lines'`
  → `1`, and `... | grep -c '^-.*but 138 AppError sites'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, F9 — "the text refers to
  commits by position and by branch sha". The Decision's three positional
  references now say round 1 and the round 1 entry no longer cites the branch
  commit. `git diff bf72d130 HEAD -- <this ticket> | grep -c '^-.*in the commit after this one'`
  → `3`, and `... | grep -c '^-.*in .b5b335b3'` → `1`.
- 2026-11-10 — Gate 1's and gate 2's full reports are on the pull request thread,
  #784; status unchanged. This pull request only files the ticket, so the thread
  is the record and the ticket carries no `## Review` section.
- **2026-11-15, built** (Sonnet 5.5, base `4e040577`, branch
  `downloader/dl-137-overflow-wrap`). dl-133 had merged (#781, `43026e11`), so
  Build 1 held. Two declarations: `overflow-wrap: anywhere` on `.card__title`
  and on `.notice__message` in `web/src/styles.css`, nothing on any wrapper.
  The boxes already shrink: `.job__titles` has `min-width: 0` and
  `.card__headline` too, and the notice is a block, so no `min-width` was
  added; the layout reading below is the proof.
  - **Five cases appended to `e2e/layout.spec.ts`**, four unbroken and the
    spaced one (Build 3 and 4), each read at 360 and 1280 px through
    `fitsBothWidths` plus a `wrapsWhole` helper (text equals the string,
    box taller than one and a half lines, right edge in the window, text not
    running past its box).
  - **Red before, green after**, `E2E_PORT=8237 npm run e2e:downloader --
    tools/downloader/e2e/layout.spec.ts`. Before the fix: `4 failed, 10
    passed`; the four unbroken cases failed at both widths on the width
    reading (`Unbroken title, analysis is 1846 px wide in a 360 px window`,
    `1998` at 1280; running job 1846 / 1998; restored job address 2091 /
    2243; restored job message 2505 / 2658) and on `taller than one and a
    half lines` and `the text runs past its box` at both widths. After:
    `14 passed (32.7s)`; the spaced case is green on both sides.
  - **What the brief had wrong.** (1) Build 3 said `line-height` reads
    `normal` and to measure height against 1.5 times the font size. It
    computes to `26.04px` (the base's `1.55` on a `16.8px` font), so one line
    is taller than 1.5 times the font size (25.2 px) and that bound passed on
    the unfixed page; the helper measures against the computed `line-height`
    instead. (2) A right edge inside `innerWidth` passes on the unfixed page
    too: the box stays the column's width and the text spills out of it
    (`scrollWidth 2063` against `clientWidth 305` in a debug read), so the
    helper also asserts `scrollWidth <= clientWidth`. Both were found by the
    first run, where the cases failed on the width reading alone and the
    wrapped-not-cut assertions passed before the fix. (3) The Why's
    "job card's heading `h3.job__title`" is `h2.card__title` on `main` now;
    the bullet says so. The rest of the Why is the filing's record of
    `a100f429` and was left as it was.
  - **Screenshots opened** (`e2e/.artifacts/layout/`, ignored by git, uploaded by CI):
    `Unbroken title, analysis-360.png` shows the 200 "T" wrapped into eleven
    lines beside the preview, the page not scrolled; `Unbroken title, running
    job-1280.png` shows it on three lines above the Re-analysing pill, whole;
    `Unbroken address, restored job-360.png` shows the address on seven lines
    above the Failed pill; `Unbroken message, restored job-360.png` shows the
    message on ten lines inside the notice, the title and code still on
    their own row.
  - **Fold-in:** none. Nothing small and already specified came free; dl-135's
    `.card__title` font-size edit is its own and was left alone.
- **2026-11-15, round 1** after gate 1 (Opus 5.5, depth full, PASS at `8f64987c`,
  CI 11 of 11 green). The owner's answers are under _Decision_, question 4, and
  record that the owner **widened this ticket to the "Embed subtitles" label,
  overriding the gate's recommendation to file**; the `Done when` lines do not
  change.
  - **F1 fixed (folded in).** A 200-character unbroken `language` in
    `probe.subtitles` (the gate's route rewrite, in the new case `an unbroken
    subtitle language in the Embed subtitles label wraps (dl-137)`, appended at
    the end of `e2e/layout.spec.ts`). Red on `8f64987c`'s stylesheet, which this
    branch still had, `E2E_PORT=8237 npm run e2e:downloader --
    tools/downloader/e2e/layout.spec.ts`: `1 failed, 14 passed`, with `Unbroken
    subtitle language is 1875 px wide in a 360 px window` and `2028 px wide in a
    1280 px window` (the gate's figures to the pixel) and `right edge inside the
    window` at both widths. Fix: `overflow-wrap: anywhere` on `.options__row
    label`, the gate's "likely direction", **measured and not assumed**: the
    anonymous flex item that holds the label's text takes its minimum size from
    the label's own `overflow-wrap`, so the one declaration on the label is
    enough, with no `min-width: 0` and nothing on the row. Green: `15 passed
    (31.1s)`. The rule is on the shared selector, so it also covers "Audio only"
    and every other label in an `.options__row`; nothing else in the stylesheet
    changed. Note the case reads the row's wrapped-not-cut figures as well: the
    label is 9 lines tall at 360 px and 4 at 1280 px.
  - **Screenshots opened:** `Unbroken subtitle language-360.png` shows "Embed
    subtitles" and the whole language on nine lines inside the Output box, the
    page not scrolled; `-1280.png` shows four lines, "(SSS…" starting on the
    second line because the text wraps before the bracket. **Where the checkbox
    goes:** it stays beside the label's text but is **vertically centred on the
    whole block, not on its first line** (`align-items: center` on the label, left
    as it is so the single-line labels keep their look and dl-135 rebases over a
    two-line diff). The brief allowed saying so in place of moving it. It is a
    choice for the owner if the first line is wanted: `align-items: baseline` on
    that selector, which would also move "Audio only" and the rest by a pixel or
    two.
  - **F2 fixed.** The running-job case's comment says the job is "still active"
    and that it reads `Re-analysing` (`probing`, 0 B) in the screenshot, with
    the reason that does not matter: every active status draws the same
    `BoxHead`.
  - **F3 fixed.** The first build's screenshot entry is corrected in place: the
    running job's title sits **above** the `Re-analysing` pill, not under it;
    the restored job's address takes **seven** lines at 360 px, not six. I also
    measured the other two counts with a temporary `console.log` of box height
    over line height, removed before the commit: the 200 "T" is 11 lines at 360
    px and 3 at 1280 px (as written), and the 200-character message is **10**
    lines at 360 px, not eleven, so that is corrected too. Counts: title 11/3,
    running job 11/3, address 7/3, message 10/3, spaced title 14/3, subtitle
    label 9/4.
  - **Fold-in:** none beyond the owner's own. `main` had moved to `e7d791d6`
    during the build and is merged into the branch in this round, before the push.
- **2026-11-15, landing** (Sonnet 5.5 fixer). The owner's two answers after gate
  2 are under _Decision_, questions 5 and 6: the checkbox stays centred (A), and
  gate 2's N1 is recorded only, unfixed. Nothing else changed at the landing.
