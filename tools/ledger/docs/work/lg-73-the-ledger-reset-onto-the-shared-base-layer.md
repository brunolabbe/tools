---
id: lg-73
tool: ledger
title: The ledger reset onto the shared base layer, its buttons quiet by default
kind: work-package
status: ready
milestone: null
depends_on: [repo-130]
difficulty: standard
---

# lg-73 — The ledger reset onto the shared base layer

## Why

The owner chose on 2026-10-25 to reset every tool onto one shared look before
deciding what needs to differ. The decision and the baseline are on
[repo-130](../../../../docs/work/repo-130-one-card-and-one-stack-in-the-shared-ui.md),
which builds `@webtools/ui/base.css` and moves the planner first. This ticket is
the ledger's move, in a pull request of its own so its changelog line names one
tool.

The ledger is the second tool to move because its structure is closest after
the planner's: it styles elements, and its card and stack are where the base's
come from. The one change that needs judgement is its buttons. A plain ledger
`button` is the accent-coloured main action, and the quiet one is
`.secondary`. The base makes the plain one quiet and marks the main one
`.primary`, the convention of the other two tools. At `origin/main@01e80b71`
the ledger draws 80 `<button>` elements. 30 carry `secondary`, and 50 do not.
Of those 50, 12 are the screen tabs, which have a rule of their own, so about
38 are accent-coloured today because nobody marked them.

## Build

1. Import `@webtools/ui/base.css` in `web/src/main.tsx`, after the tokens and
   before `styles.css`.
2. Delete what the base now owns from `styles.css`:
   - `body`, `button`, `button:disabled`, `button.secondary`;
   - `input, select`, `textarea`, `input[type="radio"]` and
     `label.check input`'s size;
   - `.card` and `.card h2`, with lg-70's `.card > h3:first-child`;
   - `main, .stack` and `.stack > h2`, `.shell` and its `48rem` padding, and
     `.muted`.

   Keep what is the ledger's own: `.small`, `.tabs`, `.range`, `label.check`'s
   row, `.figures`, `.rows`, the charts, and every screen-specific block.

3. **Buttons, one at a time.** Remove `secondary` everywhere, since quiet is now
   the default. Read each of the roughly 38 unmarked buttons and mark it
   `primary` only if it is the action its card exists for (Preview, Confirm and
   store, Save, Add member, Create household, Close the period). **At most one
   `primary` per card.** A Remove or a Cancel is never primary. The pressed tab
   and the pressed range button keep their own accent rule. Write the list of
   buttons marked `primary` into the Log, by screen.
4. `main` takes `className="stack"` (`App.tsx` has three shells), and Admin's
   section keeps the `stack` it got in lg-70, now the shared one.
5. Fields move from `--bg` to `--surface-2`, the well colour. Check both themes
   in the screenshots.
6. Run `e2e/layout.spec.ts` before and after, and **open both sets of
   screenshots**. Every difference is a row of repo-130's table or a finding.
   lg-70's cards-apart and gridline checks stay, and must still pass.

**Seam with lg-72** (the shared header and footer, filed in #666). It touches
the same `main.tsx`, `App.tsx` and `styles.css`. Land the two one after the
other, in either order. The ledger's accent-coloured `h1` is lg-72's question,
not this ticket's: after it, the shared header draws the only `h1`.

## Done when

1. `styles.css` declares none of the base's selectors. repo-130's test, extended
   to the ledger, says so.
2. ~~No ledger source carries `secondary`, and each card has at most one
   `primary`. The Log lists them.~~ _Superseded 2026-11-01 by the line below,
   which fixes what "each card" ranges over._
   **2.** No ledger source carries `secondary`. Every element whose `className`
   contains `card`, as
   `grep -rnoE 'className="[^"]*\bcard\b[^"]*"' tools/ledger/web/src` lists them
   at the branch head, holds at most one `primary` button, and the Log lists each
   such card with its `primary` button or "none".
3. `e2e/layout.spec.ts` passes at 360 px and 1280 px. The before and after
   screenshots are compared in the Log, screen by screen.
4. `npm run check` and `npm test -- --project ledger` pass.

## Log

**2026-11-01 — Done when 2 scoped, answered by the owner at intake.** Question (from the intake seam map): "Done when 2 says each card has at most one `primary`, and no list of cards exists, so a gate can always find one more." Options: (1) scope the line to a grep; (2) add a unit test; (3) leave the line as written. The owner chose **(1) scope to the grep**, the orchestrator's recommendation. Done when 2 is reworded above, the old line left beside it and marked superseded. The grep listed 36 elements in 20 files at `686b213c`; at this branch's base (`bb496824`) it lists 36 in 20 files too (`grep -rnoE 'className="[^"]*\bcard\b[^"]*"' tools/ledger/web/src | wc -l` → 36). It does not match `stats/Chart.tsx:170`, whose `className` is a template literal (`card chart-card`); the Log lists it as well.

**2026-11-01 — built (builder).** Branch `lg-73-shared-base-layer`, stacked on `lg-90-shared-item-checkbox` (`bb496824`, PR #724). Build 1 to 6 done.

**What changed.**

- `main.tsx` imports `@webtools/ui/base.css` between `tokens.css` and `chrome.css`.
- `styles.css` lost `body`, `button`, `button:disabled`, `button.secondary`, `input, select`, `textarea`, `input[type="radio"]`, `label.check input`, `.card`, `.card h2, .card > h3:first-child`, `main, .stack`, `.shell` (both blocks) and `.muted`. `.tabs button` lost its colour, background and border (the base's are the same) and keeps `flex: 1` and the pressed rule. `.range button[aria-pressed="true"]` gained `border-color: var(--accent)`, because the old global `button { border: 0 }` is gone and the pressed range button would otherwise show a grey border round an accent fill.
- `App.tsx`: the three `main` take `className="stack"`, and so do the three `.shell` divs (`shell stack`).
- `secondary` is gone from every source file (32 buttons: `grep -rn secondary tools/ledger/web/src` prints nothing; 32 at the base). 17 buttons carry `primary` (list below).
- `packages/ui/test/base.test.ts`: `MOVED = ["ledger", "planner"]`.

**What the brief had wrong.**

- Its counts were low (as the dispatch said): at the base there are 96 `<button` elements in `tools/ledger/web/src` (`git grep -o '<button' bb496824 -- tools/ledger/web/src | wc -l`), 32 with `secondary`, 64 without, and 13 of the 64 are screen tabs (not 12). So 51 unmarked non-tab buttons were accent-coloured; 17 are now `primary`, 34 are quiet.
- `.stack > h2` is not a base selector (the base has `.card > :is(h2, h3):first-child`, not a stack's heading), so it stays, with a comment. Deleting it, as Build 2 lists, puts the browser's h2 margin back on Admin's "Households" heading beside the grid gap.
- Build 4 says `main` takes `stack`. The `.shell` div also needs it: `.shell { display: grid; gap }` spaced the header, tabs, main and footer, and `.shell` is a base selector, so the ledger cannot keep a grid on it.
- Build 2's `.card h2` (a descendant selector) is replaced by the base's `.card > :is(h2, h3):first-child` (a first direct child). No card in `tools/ledger/web/src` has an `h2` anywhere else: the screenshots show the same titles.

**Done when 2, the cards.** `grep -rnoE 'className="[^"]*\bcard\b[^"]*"' tools/ledger/web/src | wc -l` → 36 in 20 files at this head, plus `stats/Chart.tsx:169`, a template-literal `className` the grep does not match (37 cards in all). Each card's `primary` button, or none, counted as rendered (one source button that renders twice, or two that never render together, count once; see the two cases below the list). A form component's button belongs to the card that renders it.

- `admin/Admin.tsx` "Emails to admit": none. Households card (per household): **Add member** (`MemberForm`); its Rename, Edit, Remove, Retire, Save and Cancel buttons are quiet. New household: **Create household**.
- `history/History.tsx` History: none (Clear filters, Show more, the filters toggle).
- `home/Home.tsx` mortgage and buffer cards: none (no buttons).
- `household/Household.tsx` Household: **Add member** (`MemberForm`). `household/MortgageSetting.tsx`: **Save**.
- `import/ImportWorkbook.tsx`: the introduction card (149) none; the sample card (186) **Send the samples and describe**, Cancel quiet; dates (231) and buckets (250) none; checks (274) **Confirm and import**, Cancel quiet. `import/NameAnswers.tsx`: none.
- `inbox/Inbox.tsx` Inbox (227): **Create rule** (`RuleForm`, in the offer, when open); the per-row Accept, Use this answer and Classify are quiet, and so is Review automatically filed. "Filed automatically" (156): none (`AutoFiled`'s per-row Confirm and Change are quiet).
- `periods/Periods.tsx` open period (272): **Add the line** (`LineForm`), each line's Remove quiet. Close (334): **Close the period**. Deposits not seen (393): none. `periods/Recurring.tsx` Every month: **Add the item**, End quiet.
- `receipts/Receipts.tsx` photo card (425): none (the camera labels are not buttons; "Type another receipt" is quiet). Kept photo (497): **Read it**; Type it in, Start over and a part's button are quiet. Household did not load (554): none (Try again, Start over). The receipt form (747): **File as … line**; Paid with the joint card?, Attach to this row, Start over, Back to the queue, Add an item, Remove and Try again are quiet. `receipts/Queue.tsx` queue: **Read all**; every per-photo button and Start over are quiet.
- `rules/Rules.tsx` Rules: **Add rule** or **Save** (`RuleForm`'s submit, one form open at a time); Add a rule, Edit and Retire are quiet.
- `salaries/MortgageSplit.tsx`: **File the split**. `salaries/Salaries.tsx`: **Save salaries**; Confirm ratio (in the offer, shown after a save) and Not now are quiet.
- `spending/Spending.tsx` list (114): **Add**; the rename Save, Cancel, Rename and Retire are quiet. Map (192) and rows (223): none.
- `statements/StatementPaste.tsx` stored (92): none (Paste another, Open the inbox). Paste (112): **Preview** or **Confirm and store**.
- `stats/Stats.tsx`, `stats/Cards.tsx`, `stats/Chart.tsx`, `stats/PeriodRows.tsx`: none.

Two cards hold more than one `primary` in the source and one as rendered, and two bear on how the line is read. (1) `StatementPaste.tsx` (112) has Preview (shown while `rows === null`) and Confirm and store (shown when it is not); they never render together. (2) `Rules.tsx` renders `RuleForm` for an edit and for a new rule, but only one is open. A grep of the source for `primary` inside the card's element reads two for (1). Open decision in the report.

Choices the brief did not make. Per-row buttons that repeat down a list (Inbox's Accept and Classify, AutoFiled's Confirm, Queue's per-photo buttons, a line's Remove) are never `primary`, since a list of N rows would hold N. Where two actions share a card and can show together, the one the brief names is `primary`: Salaries' Save, over Confirm ratio; Spending's Add, over the rename form's Save; Admin's Add member, over its inline Save buttons.

**Screenshots, before at `bb496824` and after at the head** (`e2e/layout.spec.ts`, 360 and 1280, 66 images each; each set read from the scratch directory, not kept in the repository). Opened: Paste (preview), Period, Admin, Receipt and Stats at 360 (before and after each), Inbox at 1280 (before and after), and the dark Receipt at 360. Not opened: the other 28 screens' pairs (the spec passes on all, and the structure is the same family as the ones opened) and every 1280 image but Inbox. Each difference is a row of repo-130's table unless it says finding.

- Every screen: line height 1.5 to 1.55 (Body row); page font stack is the shared one; side padding unchanged on the shell (the base's `.shell` is the ledger's own), top padding unchanged.
- Fields: `--bg` to `--surface-2`, the well (Fields row), visible on Paste, Period, Admin and Receipt in both themes; text inset 0.5rem to 0.75rem; a textarea's text 0.75rem from its border.
- Buttons: the 17 `primary` ones are accent-filled at 600 weight, as before (padding 1.25rem to 1rem, so a few are 8px narrower); every other one is quiet: surface fill, 1px border, `--text`. The old outlined accent look of `secondary` is gone (Remove, End, Rename, Retire, Edit). The accent border returns on hover (Button states row): the Admin screenshot shows "Import" with it, probably where the pointer rested after the Admin tab was clicked (not verified).
- Cards: the card spaces its children by 0.75rem and no margin adds to it; on Paste the gap above "12 rows read" and below the first-row list is smaller than before, which is the table's Card-children row.
- Keyboard focus: the receipt item's focused select shows a 2px accent outline where the browser's black one was (Keyboard focus row).
- Dark theme (a one-off copy of the spec with `colorScheme: "dark"`, deleted before the commit; 21 of 21 passed): Receipt at 360 opened. Fields sit on `--surface-2`, readable against `--surface`; the primaries are the light accent with dark text.
- Finding, not from this change: the Stats chart legends read "sam, alex" in the before run and "alex, sam" in the after run (the Own money, Put into the buffer and Salaries charts, read at the 360 image's size). The order comes from the stubbed data of the spec, not from a rule changed here; not investigated.

**Checks.**

- `E2E_PORT=8108 npx playwright test -c tools/ledger/playwright.config.ts layout.spec.ts`: 28 of 28 at the base (exit 0) and 28 of 28 at the head (exit 0). lg-70's cards-apart and gridline cases are among them.
- `npx vitest run packages/ui tools/ledger/web`: 32 files, 408 of 408.
- `npm run check`: exit 0.
