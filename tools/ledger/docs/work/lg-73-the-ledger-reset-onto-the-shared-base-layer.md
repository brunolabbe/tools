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
   **2.** ~~No ledger source carries `secondary`. Every element whose
   `className` contains `card`, as
   `grep -rnoE 'className="[^"]*\bcard\b[^"]*"' tools/ledger/web/src` lists them
   at the branch head, holds at most one `primary` button, and the Log lists each
   such card with its `primary` button or "none".~~ _Superseded 2026-11-01 by the
   line below, which fixes what "holds" counts._
   **2.** No ledger source carries `secondary`. Every element whose `className`
   contains `card`, as
   `grep -rnoE 'className="[^"]*\bcard\b[^"]*"' tools/ledger/web/src` lists them
   at the branch head, holds at most one `primary` button rendered at once (two
   source buttons that never render together count once), and the Log lists each
   such card with its `primary` button or "none".
3. ~~`e2e/layout.spec.ts` passes at 360 px and 1280 px. The before and after
   screenshots are compared in the Log, screen by screen.~~ _Superseded
   2026-11-01 by the line below, which fixes the scope of the comparison._
   **3.** `e2e/layout.spec.ts` passes at 360 px and 1280 px. Every screen's
   before and after screenshot at 360 px is opened and compared in the Log,
   screen by screen, and so is the 1280 px pair of each screen the Log names as
   one whose desktop layout differs from its 360 layout in a way the reset could
   reach. Every difference is a row of repo-130's table or a finding.
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

**Done when 1, red to green.** With `button { color: red; }` and `.shell { padding: 0; }` appended to the ledger's `styles.css` (code at `8c035ce4`, restored with `git checkout 8c035ce4 -- <file>`), `npx vitest run packages/ui/test/base.test.ts` fails `a moved tool declares none of the base's selectors in its own styles.css`, naming `ledger/web/src/styles.css declares \`button\``and`... \`.shell\``: 1 failed, 10 passed. Restored: 11 of 11. As repo-130's Log records, the guard matches selector text exactly, so `button.primary { … }` would not fail it.

**Fold-ins.** None taken. `packages/ui/test/base.test.ts`'s `MOVED` line is the one dl-135 will change next; the conflict is dl-135's, as the dispatch said.

`npm test -- --project ledger` at `8c035ce4`: 99 files, 2133 of 2133.

**2026-11-01 — three answers from the owner, relayed by the coordinator after the first report.** Each is the question, the options, the choice and whose recommendation it was. Done when 2 and 3 are reworded above, the old lines left beside them and marked superseded.

1. **How "at most one `primary`" is counted** (`StatementPaste.tsx`'s Preview and Confirm and store, which never render together; `Rules.tsx`'s `RuleForm`, rendered for an edit or a new rule, one at a time). Options: (a) count as rendered; (b) fold Preview and Confirm into one conditional button; (c) make Preview quiet. Chosen **(a) count as rendered**, the builder's and the coordinator's recommendation. Done when 2 now says "at most one `primary` button rendered at once", keeping the grep scope recorded above.
2. **Repeated per-row buttons are never `primary`** (Inbox's Accept and Classify, AutoFiled's Confirm, Queue's per-photo buttons, a line's Remove). Options: keep; promote one per-row action per screen. Chosen **keep**, the builder's and the coordinator's recommendation. No source change.
3. **Done when 3's screenshots.** The first report said five screens at 360 px and one at 1280 px were opened, of 33 screens. Options: every screen at 360 px, with 1280 px scoped to the screens whose desktop layout differs; all 66 pairs; leave it to the gate. Chosen **every screen at 360 px, 1280 px for the screens whose desktop layout differs**, the coordinator's recommendation. The comparison is in the entry below.

**2026-11-01 — the screenshots, every screen at 360 px, screen by screen (builder, after the owner's answer 3).** Before at `bb496824`, after at `8c035ce4` (the `styles.css` and markup are unchanged since; `651801ee` and `fd6bea4c` touch only this page). `layout.spec.ts` writes 33 screens at each width, 66 images per set; the 33 pairs at 360 px were each opened, before and after. The sets are in the builder's scratch directory, not in the repository. Long pages (Categories, Import, Stats, Terms: 4,000 to 5,900 px tall) are shown downscaled to about 2,000 px, or cropped, so on those the text is legible only where a crop says so. Rows quoted below are repo-130's table: **Body** (line height 1.55, font stack), **Fields** (`--surface-2` well, 44px, 16px text, `0 0.75rem`), **Buttons** (quiet by default, `.primary` the accent one), **Button states** (accent border on hover), **Card** and **Card children** (the card's 0.75rem gap, children's margins zeroed), **Keyboard focus**, **Radio, checkbox** (1.25rem), **Page column**.

Differences that hold on every screen, so they are not repeated below: line height 1.5 to 1.55 and so every page a few pixels taller (Body); the tab buttons are the same size and shape, the pressed one unchanged; page padding and column unchanged (the base's `.shell` is the ledger's old rule) (Page column); fields are on the well (Fields), 0.75rem of inset in place of 0.5rem; a button's accent border appears under the pointer (Button states); and the `Import`, `Salaries`, `Categories`, `Stats` or `Paste` tab shows that border in several "after" images (five Admin images, three Household, Import before sending, Inbox, History) where it does not in "before". The spec clicks a tab by name and then measures; the pointer rests where the click was, and the tab rows moved by a pixel or two with the new line height. That reading is mine and unverified; it is the Button states row either way, and no image shows a `:focus-visible` ring on a tab.

- **Admin**: the Households card's Rename, Edit, Remove, Retire (outlined accent before) are quiet; Add member and Create household stay accent. "People" sits closer to the list above it (Card children: the heading's own margin is gone). Verdict: table rows.
- **Admin (long household name), (long person name), (spaced household name), (never signed in), (no email)**: as Admin; the long names still break where the card ends, the "Never signed in" pill and the long address wrap as before (lg-75, lg-80 rules untouched). Verdict: table rows, no finding.
- **Admin (renaming)**: Save and Cancel in the open rename form are both quiet; Add member is the card's one primary (owner's answers 1 and 2). Finding, for the owner: while a rename form is open its Save is not the accent button, because the card's one `primary` is Add member below it.
- **Categories**: each category's Rename and Retire are quiet, and the rows are closer together (Card children). "Add" stays accent. Read at the downscaled size.
- **Header (admin)**, **Header (household)**, **Header (no household)**: the same as Admin, Home and the stranger's page; the header and footer are `chrome.css`'s and did not move.
- **History**: the Filters toggle, Clear filters and Show more are quiet (outlined accent before); rows unchanged but a little taller. The card has no `primary` (a filter screen has no submit).
- **Home**: no buttons; the cards are spaced the same, a few pixels taller from the line height.
- **Household**, **(long household name)**, **(no email)**, **(renaming)**: Rename and the open form's Save and Cancel are quiet, Add member and the mortgage Save are accent. "Members", "Add a member" and "History" sit closer to the text above them (Card children). The mortgage radios are 20px, as before (Radio, checkbox).
- **Import (before sending)**: Send the samples and describe is accent, and Cancel, accent-filled before, is quiet. The offer box keeps its accent border (the ledger's own `.offer`).
- **Import (names)**, **Import (read)**, **Import CSV (read)**: Confirm and import is accent and Cancel quiet; headings sit closer to their text and the sample lists (Card children); the name selects and the new-person field are on the well. (Import (read) is read at 157 px wide: structure and buttons only.)
- **Inbox**: no accent button; Classify, Accept and Use this answer are quiet (owner's answer 2). The selects are on the well. Finding, for the owner: this screen has no accent action at all until the offer form opens.
- **Paste (preview)**: Confirm and store is the one accent button; the textarea is on the well, with 0.75rem of inset; the summary line is closer to the textarea (Card children).
- **Paste (stored)**: Paste another is quiet, and the card has no `primary` (the brief's list did not name it). Finding, for the owner: the screen's only action reads as an unmarked button.
- **Period**: Add the line, Close the period and Add the item are accent; Remove and End are quiet; the date inputs and selects are on the well.
- **Receipt queue (kept)**: Read all is accent; every Type it in and Start over are quiet; the file input in "Add more photos" is on the well (Fields: `input[type="file"]` takes the text-field rule, as `input` did).
- **Receipt queue (left out)**: as kept, with the red list unchanged.
- **Receipt queue (read)**: the per-receipt buttons (each receipt's name and total) are quiet (accent-filled before), so the screen has no accent button but Start over's neighbours are all quiet. Finding, for the owner: a photo's receipts are this screen's main actions and now look like Start over.
- **Receipt**: items' text fields and selects on the well; Remove and Add an item quiet; File as alex's line accent, Paid with the joint card? and Start over quiet; the focused select shows the accent outline where the browser's black one was (Keyboard focus); the checkboxes are 20px (Radio, checkbox).
- **Rules**: Edit, Retire and Add a rule are quiet. Finding, for the owner: the Rules screen has no accent button until its form is open (the form's submit is the card's `primary`).
- **Salaries**: Save salaries and File the split are accent; the year, the salaries and the date field are on the well; the radios 20px.
- **Stats**: the range buttons (This year, Last 12 months, Pick days) and every Show as a table, Rows and Show the rows are quiet (outlined accent before); the pressed range button keeps its accent fill with an accent border. The charts, gridlines, legends and readouts are unchanged in structure and width (checked in three crops of 1,990 px each, before and after). The legend and series colours swap between the two runs: see the next paragraph.
- **Terms**: identical to the pixel at both widths: `differing pixels 0 of 1497960` at 360 and `0 of 2984960` at 1280 (a script comparing the two PNGs). The terms page is a static page the stylesheet does not reach.

**1280 px, the screens whose desktop layout differs from their 360 layout in a way the reset could reach.** Named, with the reason; the pair of each was opened. (a) **History**: from 48rem the filters sit in two columns with the toggle hidden (`.filters .rule-form`), and the base's field rule (`width: 100%`, `min-height`, padding) is what sizes the fields in those columns. (b) **Stats**: the charts are drawn at their container's measured width and scroll inside `.chart-scroll`, and the base's `.card` (`min-width: 0`, `display: grid`) and `.stack > *` now size that container. (c) **Receipt**: the items' fields are a wrapping flex row at 1280 (name, price, deposit, rebate, the Taxable and Shared checkboxes on one line) and the checkbox rule (`flex: none`, 1.25rem) and the field rule reach it. (d) **Admin**: the members and people rows are flex rows with their buttons at the right, which the button rule (padding, 44px) reaches. (e) **Import CSV (read)**: its rows are a two-column grid with a monospace report, which the base's `code` and card rules reach. (f) **Inbox** (opened in the first report): the answer fields sit in rows with their labels. The other screens are one column at both widths or are the 360 layout widened (Home, Period, Paste, Salaries, Rules, Categories, Household, the queue, Terms), and the 360 pair covers them.

- **History at 1280**: the two columns hold; the fields are on the well and 44px, as at 360; the page column is the same width. Table rows.
- **Stats at 1280**: the top 2,000 px of 5,301 and 5,316 compared: the charts fill the card at the same width, the tick labels and gridlines are where they were, no horizontal scroll in either; the range buttons and Show as a table are quiet. Table rows. The pages are 15 px different in height (Body).
- **Receipt at 1280**: the name field takes the first row and the price, deposit, rebate, Taxable and Shared sit on the second, as before; the 20px checkboxes sit on the label's line. Table rows.
- **Admin at 1280**: the rows keep their buttons at the right edge; the buttons are quiet. Table rows.
- **Import CSV (read) at 1280**: the sample rows keep their two columns, the report is monospace and unwrapped as before, Confirm and import accent and Cancel quiet. Table rows.
- **Inbox at 1280**: as in the first report.
- Not opened at 1280: the other 27 screens' pairs (the spec passes on all at 1280; they are single-column or the 360 layout widened).

**The Stats legend order, "sam, alex" before and "alex, sam" after: the stubbed data's person ids, not this branch.** The series are ordered by person id (`tools/ledger/books/src/stats.ts` line 67, `return [...ids].toSorted()`, and lines 120 and 150, `a.personId < b.personId`), and each person's id is `randomUUID()` (`tools/ledger/api/src/directory.ts` line 963, `(person.newId ?? randomUUID)()`); `layout.spec.ts` adds alex and sam by name against a server whose storage `playwright.config.ts` removes on every run, so which of the two ids sorts first is chosen anew each run. The evidence is the same code read twice: the "after" run (`8c035ce4`) shows "alex, sam" in the Stats crop (alex blue) and the dark run, also at `8c035ce4`, shows "sam, alex" (sam blue); the colour follows the position, not the person, in both. The branch changes nothing in `books`, `api` or the chart code (`git diff bb496824 HEAD --stat -- tools/ledger/books tools/ledger/api tools/ledger/web/src/stats` lists only the `.tsx` `secondary` edits in `web/src/stats`).

This entry supersedes the "Opened: ... Not opened: ..." sentence of the built entry's screenshot paragraph; its bullets there stand as a first reading.

**2026-11-01 — two answers from the owner at the landing, relayed by the orchestrator after gate 1.** Each is the question, the options, the choice and whose recommendation it was.

1. **Gate 1's two lows** (both Log wording: the first about the tab's accent border in the screenshot entry, the second about the tab buttons being unchanged). Options: correct both at landing; record both unfixed. Chosen **correct both at landing**, the orchestrator's recommendation. The fixes are in their own commit, each with its own entry below.
2. **The reset leaves Inbox, History and Rules with no accent button, Paste (stored) with only a quiet "Paste another", the read receipt queue's buttons looking like Start over, and the rename forms' Save quiet.** Options: accept as built; file a follow-up ticket; change before landing. Chosen **accept as built**, the orchestrator's recommendation. Nothing is filed and nothing changes.
