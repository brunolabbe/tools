---
id: pl-21
tool: planner
title: Four field kinds render an input a screen reader cannot name
kind: chore
status: ready
milestone: null
depends_on: [pl-12]
---

# pl-21 — Name the bare fields

**Packages:** `web` (and its tests)

## Why

`text`, `text-list`, `number` and `number-list` each render a control carrying an
`id` and nothing else — `id={`field-${question.id}`}` in
`web/src/wizard/controls.tsx`, with no `<label>` anywhere and no `aria-*`. The
prompt the control is asking about is an `<h2>` one level up, in `QuestionCard`
(`web/src/wizard/Wizard.tsx:258`), and nothing connects the two. A screen reader
lands on the field and announces an unlabelled text box: the user is told there is
something to type into and never told what.

Found by [pl-12](./pl-12-render-the-wizard-in-tests.md) while building the
component suite, and **deliberately left alone there** — pl-16 was editing
`web/src` in parallel, the component suite could be written without it, and the
gap was written up in [03-STATUS.md](../03-STATUS.md) rather than fixed in
passing. That reason has since expired: pl-16 landed, and nothing is editing
those files now. This is that finding, written down as work.

**It is four kinds and not a systemic gap**, which is the reason it is a chore and
not a work package. The choice controls wrap their input in a `<label>`, and
`dates` and `budget` label every one of their sub-fields with an explicit
`htmlFor` — `date-departure`, `budget-currency` and the rest are all correct
today. So the pattern is understood in this file and four controls simply do not
follow it.

Two things make it worth closing rather than tolerating:

**The `id` is already there, so the fix is small and the omission is invisible.**
An `id` with no label reads, at a glance, like a labelled field — it is the
attribute a label would need. Nothing in the suite fails, nothing in `npm run
check` fails, and the rendered page looks right.

**A test can hold it, and the test is one this tool already wants.** The rule in
`tools/planner/CLAUDE.md` is that a spec reads the screen and never names a
question, because the tree is content. Asking for a control **by its prompt** is
precisely that rule applied to the field itself, and it is only possible once the
control has an accessible name. So the fix and the assertion arrive together, and
the assertion is stronger than the one it replaces.

## Build

1. **Give the prompt a stable id in `QuestionCard`** and point each bare control
   at it with `aria-labelledby`. The `h2` already renders the prompt and is the
   right element to name the field — a second copy of the text in an
   `aria-label` would be one more place for the tree's content to be restated,
   which is the thing this tool avoids everywhere else.
2. **Do the same for `help`.** `QuestionCard` renders `question.help` as a
   `<p className="help">` when the tree provides one. It is the sentence that
   explains the question, so it is `aria-describedby` — description, not name,
   because a screen reader should announce the prompt and then the elaboration
   rather than a run-on of both.
3. **Assert it by prompt, in the `web` suite.** For each of the four kinds, ask
   for the control by the prompt the tree gave it —
   `getByRole("textbox", { name: <prompt> })` and its `spinbutton` equivalent —
   rather than by `#field-<id>`. Both sides of the assertion then move when the
   tree does.
4. **Check the three that are already right stay right** by writing the same
   query against one choice control and one `dates` sub-field, so the test says
   "every control has an accessible name" rather than "these four do".

Traps worth knowing in advance:

- **`aria-labelledby` on the `<textarea>`, not a wrapping `<label>` around the
  `h2`.** A heading inside a label is invalid and the choice controls' shape does
  not transfer: those wrap a small `<span>`, and the prompt here is the card's
  own heading with the help text and the decline button beside it.
- **The id must be per-question, not a constant.** `QuestionCard` renders one
  question at a time today, so a fixed `id="question-prompt"` would work and would
  be a trap set for whoever renders two — derive it from `question.id` the way
  the field does.
- **All four kinds are the simple one-control case, and the trap is that two of
  them look like they might not be.** "List" suggests a control per item, each
  needing a name that distinguishes it from its siblings. Neither list kind is
  that: `TextList` is a single `<textarea>` of newline-separated values and
  `NumberList` a single `<input type="text" inputMode="numeric">` of
  comma-separated ones, both parsed in the control's own `update`. So one
  `aria-labelledby` per control is right in all four places — check that before
  building a per-item scheme for items that do not exist.
- **This is not an accessibility audit.** Contrast, focus order, keyboard traps,
  live regions and the discard dialog's focus management are all out of scope. The
  finding is four controls with no accessible name; widening it is how a chore
  becomes a quarter.

## Done when

- Asking for each of the four bare controls by its prompt finds it, in the `web`
  suite, on the same jsdom surface pl-12 established.
- The same query finds a choice control and a `dates` sub-field, so the assertion
  is about every control rather than about the four that were broken.
- No prompt text is duplicated into an `aria-label` — the name comes from the
  element already rendering it.
- `npm run check` and `npm test -- --project planner` pass.

## Log

**2026-08-22 — built.** `QuestionCard` gives its `h2` `id={promptId(question.id)}`
and its help paragraph `id={helpId(question.id)}`; the four bare controls spread
`namedByCard(question)`, which is `aria-labelledby` on the prompt plus
`aria-describedby` on the help _only when the node has one_. Both id helpers are
exported from `controls.tsx` and imported by `Wizard.tsx`, so the two sides of
the reference are derived in one place rather than agreeing by coincidence — the
same reason the field's own `id` is built from `question.id`. No prompt text is
copied into an `aria-label`.

Three things the brief did not say, and one it had slightly wrong:

- **The assertion could not go in `controls.test.tsx`.** Build step 3 says "in
  the `web` suite" without naming a file, and the obvious reading is the file
  that owns the controls. It cannot be: that suite mounts `QuestionField` on its
  own, and the element `aria-labelledby` points at lives in `QuestionCard`, a
  level up — the name computes to empty there. The three new tests are in
  `wizard.test.tsx`, which renders the real card, and `controls.test.tsx`'s
  docblock now says where they went instead of describing the gap as permanent.
  Nothing in `controls.test.tsx` had to change otherwise: every query there is by
  role alone or by a name the field carries itself.
- **`getByRole` cannot ask for a `dates` sub-field by name in the general case.**
  Build step 4 wants "the same query" against one, but `<input type="date">` has
  no mapped ARIA role, so `date-departure` and `date-earliest` are unreachable by
  role — `getByLabelText` is the only way to them, which is what the existing
  tests use. The sub-field asserted by role and name is therefore `Nights`
  (`type="number"` → `spinbutton`), reached by first choosing the "However long,
  whenever" mode. It is a real `dates` sub-field with a real `htmlFor`, so the
  claim holds; it just is not the departure date.
- **The help text earned a test of its own.** `aria-describedby` is omitted
  rather than pointed at an id that was never rendered when `help` is null, and
  the second new test holds that — a dangling `aria-describedby` is invisible in
  every way an unlabelled field is.
- The trap about the two list kinds being single controls was correct and worth
  the paragraph: one `aria-labelledby` per control is right in all four places.

`03-STATUS.md`'s "The bare fields still have no accessible name" paragraph is
gone, since it stops being true when this lands. The status table row still says
`ready`, per the convention in `docs/01-TICKETS.md` that a ticket file does not
know about a branch.

Gates: `npm run check` and `npm test -- --project planner` both pass (529 tests
over 40 files, 42 of them in `web`, up from 39). Neither runs the planner's e2e suite or the
container build — this changes what the browser loads, so CI's `planner.yml` is
the first thing to prove the built bundle. Removing the four spreads makes two
of the three new tests fail, which is the check that they are load-bearing.
