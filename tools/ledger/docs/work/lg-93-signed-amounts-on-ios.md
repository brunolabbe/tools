---
id: lg-93
tool: ledger
title: Negative amounts may have no minus key on an iPhone's decimal keypad
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# lg-93 — Negative amounts may have no minus key on an iPhone's decimal keypad

## Why

The hypothesis: an `<input inputMode="decimal">` on an iPhone opens a keypad
with digits and a decimal separator but no minus key, so a person on an iPhone
may be unable to type a negative amount such as `-2.00`. The case that matters
most is a returned item, whose price is negative (`contract/src/receipts.ts`,
the comment on `ReceiptItem.price`).

It was raised by the builder of lg-89 (draft pull request #717, branch
`lg-89-fold-rebate-into-item`) while it built a Rebate field beside each item's
Price and Deposit. Nobody has measured it. No iOS device was available to that
builder or to the filing of this ticket, so **this is a hypothesis**. Nothing
about the keypad below is a fact until Build step 1 records one. No fix is
written before that reading and the owner's answer.

The parser is not the problem. `parseTypedAmountCents`
(`books/src/amount.ts`, line 46) already reads a leading `-` or `−` in a typed
amount, and the forms that use it take a negative where the table says so. What
is in question is only what the keyboard offers.

### Where a negative is a legitimate entry

Read from the code on `origin/main` at `8ad4e91d`. The grep in
_Reproduction_ finds ten sites. Subtotal, GST, QST, Total and Charged are not
in its output as separate lines: they reach the same `inputMode={mode}` line
through the `field()` helper in `receipts/Receipts.tsx`, which defaults to
`decimal`, so they are listed here with the grep's own lines.

| Where                                    | Field                                          | Negative a legitimate entry?           | From the code                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ---------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `receipts/Receipts.tsx:721`              | Price of an item                               | **Yes**                                | `contract/src/receipts.ts:57`: "A discount or a returned item is negative."                                                                                                                                                                                                                  |
| `receipts/Receipts.tsx:727`              | Deposit on an item                             | **Not settled**                        | The schema admits it (`receipts.ts:110`, `cents`, from `-MAX_CENTS`). Nothing in the contract says a deposit is ever negative, so the code does not answer it. A returned bottle's deposit refund is the case to ask about.                                                                  |
| `receipts/Receipts.tsx:668` (helper)     | Subtotal, GST (TPS), QST (TVQ), Total          | **Yes, on a refund**                   | `receipts.ts:11`: "A refund is negative, as the models measured on lg-8 read one."                                                                                                                                                                                                           |
| `receipts/Receipts.tsx:668`, used at 799 | Charged to the card (with any tip)             | **Yes, on a refund**, by the same rule | The refund rule above is stated for the receipt's amounts; the code does not name this field separately.                                                                                                                                                                                     |
| `history/History.tsx:343` and `:350`     | Filter bounds "At least ($)" and "At most ($)" | **No**                                 | `bound()` (`History.tsx:81–84`) returns `null` for a negative, and the form says "Type an amount like 12.50 in dollars." The contract bounds are `min(0)` (`contract/src/api.ts`, `rowsQuerySchema`, `minCents` and `maxCents`), and the server compares `Math.abs` (`api/src/rows.ts:182`). |
| `periods/LineForm.tsx:117`               | Amount of a period line                        | **Yes**                                | `PeriodLine.amountCents`: "Positive for a purchase; a refund on a shared purchase is negative" (`api.ts`, lines 1046–1047). `periodLineDraftSchema` takes `-MAX_CENTS` to `MAX_CENTS`, non-zero (`api.ts:1077`). The form refuses only zero (`LineForm.tsx:62`).                             |
| `periods/Recurring.tsx:148`              | Each month                                     | **No**                                 | The form refuses `monthlyCents <= 0` (`Recurring.tsx:78`). The contract is `min(1)` (`api.ts:1161`).                                                                                                                                                                                         |
| `rules/RuleForm.tsx:110`                 | Exact amount of a rule                         | **Yes**                                | Bank rows are signed, "negative for money out" (`contract/src/layout.ts:93`), and a rule matches a row on its exact amount. `ruleDraftSchema` has `amountCents: z.number().int().nullable()` with no sign bound (`api.ts:531`).                                                              |
| `salaries/Salaries.tsx:215`              | A person's salary                              | **No**                                 | The form refuses `amountCents < 0` (`Salaries.tsx:140`). `salaryEntrySchema` is `min(0)` (`api.ts:784`).                                                                                                                                                                                     |
| `salaries/MortgageSplit.tsx:159`         | A person's part, in %                          | **No**                                 | `parseShare` (`web/src/labels.ts:82`) refuses a sign: its pattern takes digits, a `.` or `,` decimal part and a trailing `%`. `partsPerMillion` is `min(0)` (`api.ts:965`).                                                                                                                  |

So the fields where a minus key would matter are the five rows marked **Yes**
(the Price, the receipt's money fields and Charged, the period line's Amount and
the rule's Exact amount), plus Deposit once its answer is known. The rest are
not negative entries, and a keyboard change there is not needed.

**Not on `main` yet.** lg-89 (draft pull request #717) adds a Rebate input beside
each item's Price and Deposit, with `inputMode="decimal"` and the placeholder
"Rebate". Its contract comment makes a rebate negative on a purchase and the
opposite sign on a returned item. So a Rebate is a further field where a negative
is the normal entry. It lands with #717, not with this ticket, and the table does
not list it.

### What the documentation says — not a device measurement

Read on 2026-11-01 from the sources named, none of them a measurement on an
iPhone of the ledger's fields. It informs the choice and does not replace Build
step 1. Where a source states an iOS version or a date, it is given.

**(i) `inputmode="decimal"`.**

- The HTML standard defines `decimal` as "a virtual keyboard capable of
  fractional numeric input. Numeric keys and the format separator for the locale
  should be shown." It does not mention a minus key
  (<https://html.spec.whatwg.org/multipage/interaction.html#input-modalities:-the-inputmode-attribute>;
  its compatibility note gives Safari on iOS 12.2+ for `inputmode`).
- MDN says of both `decimal` and `numeric`: "Devices may or may not show a minus
  key" (<https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode>,
  undated).
- WebKit's source maps `inputmode="decimal"` to UIKit's `UIKeyboardTypeDecimalPad`
  (`WKContentViewInteraction.mm`, the `switch (_focusedElementInformation.inputMode)`
  block, `main` read 2026-11-01; the file's newest commit is `1e6d8280` of
  2026-10-30:
  <https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm>).
  Apple describes that type as "a keyboard with numbers and a decimal point",
  available from iOS 4.1, with no mention of a sign
  (<https://developer.apple.com/documentation/uikit/uikeyboardtype/decimalpad>).
  The source says which UIKit keyboard is asked for, not which keys it has: the
  key layout is UIKit's and not published.
- A WebKit bug filed 2019-01-25 against iOS 12.2, "inputmode="decimal" on iOS 12.2
  doesn't have a button for negative", is answered the same day by a WebKit
  engineer: "it doesn't look like UIKit supports a number pad UIKeyboardType with
  a minus key (hyphen)". Status NEW, no resolution recorded
  (<https://bugs.webkit.org/show_bug.cgi?id=193825>). This is the strongest source
  for the premise, and it is seven years old.
- Third-party reports, secondary: "Both decimal and numeric inputmode does not
  support a minus on the IOS keyboard", 2023-02-02, iOS version not given, the
  reporter's guess being iOS 13 on
  (<https://github.com/dm4t2/vue-currency-input/issues/372>); and a report on
  Xamarin.Forms of 2019-06-19 that the iPhone's `DecimalPad` has no sign key
  ("The iPad behaves correct and shows a more complete numeric keyboard")
  (<https://github.com/xamarin/Xamarin.Forms/issues/6580>). A Mantine issue opened
  by a user on 2026-11-01 (<https://github.com/mantinedev/mantine/issues/9370>)
  repeats the claim and gives no source for it; the issue's own sentence, "This
  behavior is evident from the source; I have not attached a device recording",
  is about a prop-ordering regression, so the issue adds nothing.
- **No source found states a measurement of the decimal pad's keys on a current
  iOS.** The premise is documented and consistent across sources; it is not
  measured on iOS 26.

**(ii) The other keypads, and `pattern` and `type`.**

- `numeric` maps to `UIKeyboardTypeNumberPad` (same WebKit block). Apple:
  "a numeric keypad for PIN entry", which "prominently features the numbers 0
  through 9" (<https://developer.apple.com/documentation/uikit/uikeyboardtype/numberpad>).
  WebKit's own bugs record the change: before it, iOS 12 `numeric` showed the
  numeric keyplane with "all sorts of punctuation" (bug 200226, 2019-07-29,
  <https://bugs.webkit.org/show_bug.cgi?id=200226>); bug 197916, 2019-05-15, fixed
  in r245338, made it "a number pad with digits 0-9"
  (<https://bugs.webkit.org/show_bug.cgi?id=197916>), in the iOS 13 beta. A WHATWG
  thread of January 2020 says iOS 13 dropped the punctuation from `numeric`
  (<https://github.com/whatwg/html/issues/3478>). So on a current iOS `numeric`
  is documented as digits only.
- `text` maps to `UIKeyboardTypeDefault` (Apple: "the default keyboard for the
  current input method"); the HTML standard: "a virtual keyboard capable of text
  input in the user's locale". Neither source lists its keys. That it carries a
  minus behind its numbers layer is common knowledge, not a sourced claim here.
- `tel` maps to `UIKeyboardTypePhonePad`; the standard gives the digits 0 to 9,
  `#` and `*`. `search` maps to `UIKeyboardTypeWebSearch`, which Apple calls "a
  keyboard for web search terms and URL entry". Neither is a candidate: no source
  gives either a minus key.
- **`pattern` and `type="number"`**, from `WebPage::inputTypeForElement` and the
  block above
  (<https://github.com/WebKit/WebKit/blob/main/Source/WebKit/WebProcess/WebPage/WebPage.cpp>,
  `main` read 2026-11-01). When `inputmode` is unspecified or `none`: a
  `type="number"` field, or a text field, whose `pattern` is exactly `\d*` or
  `[0-9]*` gets the number pad; any other `type="number"` gets
  `UIKeyboardTypeNumbersAndPunctuation`; a text field with any other pattern gets
  the default keyboard. **When `inputmode` is set to a keyword, that block decides
  and the field's type and `pattern` are not consulted**, so per the source a
  `pattern` cannot change what `inputmode="decimal"` shows. The HTML standard says
  `type` and `pattern` "should be used" for the case where `inputmode` is
  unspecified. The
  `\d*` trick is also documented as the pre-12.2 way, "the only way", to steer
  Safari's keyboard (<https://catskull.net/ios-inputmode.html>, 2019-04-17). These
  are source readings of `main`, not of the build on a given iPhone.

**(iii) Digits, a decimal separator and a minus key together.**

- No `inputmode` keyword is documented to give all three: the standard's list has
  none, and bug 193825's engineer writes that "it doesn't look like UIKit
  supports a number pad UIKeyboardType with a minus key".
- `UIKeyboardTypeNumbersAndPunctuation` is the keyboard named for it. The WebKit
  engineer in bug 193825 says it "contains all the relevant keys, but it isn't a
  number pad"; a forum user's answer (not Apple's) of August 2022 on the Apple
  Developer Forums to "KeyboardType for negative numbers?" gives it, or the default keyboard, as the way to type a
  negative, and adds that it "would be better to have just digits, separator and
  +/-" (<https://developer.apple.com/forums/thread/711839>; read through
  `WebFetch`, not raw). Apple
  lists no keys for it ("the numbers and punctuation keyboard"). On the web the
  source reaches it by `type="number"` with no `inputmode` and no `\d*` pattern,
  which is a different field from the ledger's (every one of the ten sites is a
  text field today) and has a locale defect recorded under (iv).
- `inputmode="text"` is what a maintainer of vue-currency-input proposes to
  preserve, in a comment on #372, and what the user who opened Mantine #9370 asks
  for; both are secondary reports, and the second is unmeasured.
- A commenter on bug 193825 (2023-09-12) posts a `data:` URL
  (`data:text/html,<input type="number" inputmode="decimal">`) with the words "to
  test this on an iOS device." The comment names neither Safari nor typing and
  reports no result, so it is no evidence that Safari opens such a URL typed by
  hand. Build step 1 uses a `data:` URL to reach the alternatives and labels that
  premise unverified.

**(iv) Does the decimal separator follow the locale?**

- The standard and MDN both say yes: "the format separator for the locale", "the
  digits and decimal separator for the user's locale (typically . or ,)". Apple's
  page for `decimalPad` says nothing on it.
- **What the locale is, on iOS, is not settled by any source.** An Apple Developer
  Forums thread, August 2018 to January 2019, on iOS 12, finds the pad's separator
  differing from `Locale.current.decimalSeparator`: with a German primary
  keyboard and an en-US one also enabled the pad showed `.`, and removing the
  en-US keyboard made it `,`; another poster says it follows the Region, another
  that German language with German region gave `.` and English with German region
  `,`. No Apple answer; the original report was filed as rdar://42338031
  (<https://developer.apple.com/forums/thread/107269>). So enabled keyboards,
  Region and Language are each claimed, and none is confirmed.
- A separate, newer defect concerns `type="number"` only: in iOS 26.2, 26.3 and
  26.4 beta, Safari inserts `.` for the comma key on a comma-decimal system
  language; an Apple engineer reproduced it, in French too; not seen on iOS 26.1
  and earlier; filed as FB22063448; March 2026
  (<https://developer.apple.com/forums/thread/818268>). It says nothing of
  `inputmode`.
- For this ledger: `parseTypedAmountCents` (`books/src/amount.ts`, line 46) reads
  both `400.50` and `400,50` and `-1 100,00`, so the form takes either separator;
  the open question is only which one the pad shows on a French-Canadian phone,
  and Build step 1 records it.

## Reproduction

Run on 2026-11-01 from a worktree at `origin/main` `8ad4e91d`:

```
$ git grep -n 'inputMode="decimal"\|inputMode={mode}' origin/main -- tools/ledger/web/src
origin/main:tools/ledger/web/src/history/History.tsx:343
origin/main:tools/ledger/web/src/history/History.tsx:350
origin/main:tools/ledger/web/src/periods/LineForm.tsx:117
origin/main:tools/ledger/web/src/periods/Recurring.tsx:148
origin/main:tools/ledger/web/src/receipts/Receipts.tsx:668
origin/main:tools/ledger/web/src/receipts/Receipts.tsx:721
origin/main:tools/ledger/web/src/receipts/Receipts.tsx:727
origin/main:tools/ledger/web/src/rules/RuleForm.tsx:110
origin/main:tools/ledger/web/src/salaries/MortgageSplit.tsx:159
origin/main:tools/ledger/web/src/salaries/Salaries.tsx:215
```

## Build

1. **Measure on a real iPhone first, and record it in the Log before anything
   else.** One session prices options (a) and (d). The owner, or anyone with an
   iPhone, names the device and the iOS version, and also Settings > General >
   Language & Region (the Language and the Region) and Settings > General >
   Keyboard > Keyboards (those enabled), because the documentation does not
   settle which of them sets the decimal separator. Then two readings, in Safari:
   - **The fields as they are.** Open the production ledger and tap into each
     field the table marks **Yes** or **Not settled**. For each, the Log records
     whether the keypad offers a minus key and which decimal separator (`.` or
     `,`) it shows. The Rebate field is included only if #717 has merged; until
     then it is recorded as not measured.
   - **The alternatives.** The production site cannot be made to show them, so
     use a scratch page that is not part of the repository. **Unverified: that
     Safari opens a `data:` URL typed into its address bar.** No source found
     says it does (the one comment that posts such a URL reports no result), and
     it was not tried on a device. Type this into Safari's address bar (it is on
     one line; copy it from a computer to the phone, in Notes or a message,
     rather than retyping it):

     ```
     data:text/html,<meta name="viewport" content="width=device-width"><p>A <input inputmode="decimal"><p>B <input inputmode="decimal" pattern="-?[0-9.,]*"><p>C <input inputmode="text"><p>D <input inputmode="numeric"><p>E <input pattern="-?[0-9.,]*"><p>F <input type="number">
     ```

     If Safari does not open it, save the same line's HTML as `keys.html`, serve
     it from a computer on the same network (`python3 -m http.server`, from the
     directory holding it) and open `http://<the computer's address>:8000/keys.html`
     on the phone; say which was used. Tap into
     each of A to F. For each, the Log records the keypad's kind (a number pad
     with digits only, a digits-and-decimal pad, the full keyboard, or the
     numbers-and-punctuation layer), whether it has a minus key, whether it has a
     decimal separator and which, and how many taps from the keypad as it first
     opens a minus key takes (0 if shown at once; 1 if it sits behind the `123`
     key). What the documentation expects of each, to be confirmed or refuted by
     the device and cited from _What the documentation says_:

     | Row | What it is                                                                                         | The documentation expects                                               |
     | --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
     | A   | `inputmode="decimal"`, as the fields are now                                                       | the decimal pad, with no minus key                                      |
     | B   | `inputmode="decimal"` and a `pattern`: does a `pattern` change what an explicit `inputmode` shows? | the same as A, since the source does not consult `pattern` there        |
     | C   | `inputmode="text"`: option (a)                                                                     | the default keyboard; a minus behind `123` is expected, not sourced     |
     | D   | `inputmode="numeric"`                                                                              | a digits-only number pad                                                |
     | E   | no `inputmode`, a `pattern` that is not `\d*` or `[0-9]*`: does a `pattern` alone change anything? | the default keyboard                                                    |
     | F   | `type="number"`, no `inputmode`                                                                    | the numbers-and-punctuation keyboard, which the sources say has a minus |

     An Android phone or a desktop browser is not this measurement. A row the
     session did not reach is recorded as not measured, and the option it prices
     is then priced by the documentation alone.
2. **Stop there.** The owner answers the decision below with the reading in front
   of them. If every **Yes** field's keypad offers a minus key, option (d) is the
   answer.
3. **Then the answer is recorded first.** It goes under
   `## Decision — answered <date> by <who>`, with the options it was chosen from,
   in its own commit that moves `status` to `ready`, before any source change.
   The chosen option's Build steps are written into this section in that commit,
   and so is its check, added to _Done when_ as line 3, before any source change.

## Decision — open

**Open: what a person on an iPhone types for a negative amount.** Nothing here is
chosen. Build step 1 comes first, and each option is priced from the code in
_Why_.

1. **(a) A keyboard that offers a minus key** on each field the table marks
   **Yes**, by an `inputMode` the measurement shows gives one (`inputMode="text"`
   is the obvious one). Costs, as the documentation expects (row C records the
   keypad's kind, never the speed of typing): the full keyboard would replace the
   number pad on those fields for every phone, so every amount would be typed
   more slowly, not only the negative ones. Whether a `pattern` attribute changes the iOS keypad at all is
   part of the measurement and is not assumed.
2. **(b) Unsigned entry on the Rebate field only**, with the sign implied by the
   field. Costs: it applies only to lg-89's Rebate field, which is not on `main`
   yet. It leaves Price, where a returned item's negative price is typed, and every
   other **Yes** field as they are, so it does not answer the iPhone problem for
   them. And a rebate's sign is not always the same: lg-89's contract comment
   makes a rebate on a returned item the opposite sign, which a field that only
   sees the typed number cannot tell apart.
3. **(c) A sign toggle beside each field where a negative is legitimate.**
   Costs: a new control on each **Yes** field, and on the Rebate once it lands.
   It works on any keypad, so it does not depend on the measurement, and desktop
   users get the same control, so no keyboard hint changes. It is the largest UI
   change of the four.
4. **(d) Close it, if the measurement shows iOS offers a minus key** on each
   **Yes** field. Costs: nothing to build. The reading recorded in the Log is the
   whole deliverable, and it holds only for the device and iOS version measured.

## Done when

1. The Log records the device, the iOS version, the Language, the Region and the
   enabled keyboards; and then, for each field the table marks **Yes** or **Not
   settled**, the keypad an iPhone showed, whether it offers a minus key and
   which decimal separator it shows; and, for each of the rows A to F of Build
   step 1's scratch page, the keypad's kind, whether it has a minus key, a
   decimal separator and which, and the taps a minus key takes; and, for each
   row, whether the device confirmed or refuted what the documentation expects
   of it; and which delivery of the scratch page was used (the `data:` URL typed
   into Safari, or the served `keys.html`); and, once #717 has merged, the Rebate
   field's keypad, minus key and separator. A field or a row not measured is
   named as not measured, the Rebate field included.
2. The owner's answer is recorded under `## Decision — answered <date> by <who>`,
   with the options it was chosen from, and `status` is `ready`.

## Log

- 2026-11-01: filed from the builder of lg-89 (draft pull request #717, branch
  `lg-89-fold-rebate-into-item`), which raised the question of the iOS keypad in its own build and
  could not measure it. Reproduction run on `origin/main` `8ad4e91d`, output in
  _Reproduction_ above: ten lines. The table in _Why_ was read from `main`'s
  source, not from the grep alone. It adds Subtotal, GST, QST, Total and Charged,
  which the `field()` helper renders through `inputMode={mode}`, and it covers
  both `salaries/` files, which the grep also matches. No iOS device was used, so
  nothing about the keypad is measured. Status is `needs-decision` on the
  owner's pending answer; difficulty is `standard`, rated for the work once an
  option is chosen, all four options being within it.
- 2026-11-01: web check, on the owner's word that the online documentation may be
  consulted. Documentation, not a device measurement; the findings and their
  sources are in _What the documentation says_ in _Why_. In short: WebKit's
  source maps `inputmode="decimal"` to UIKit's decimal pad, and the source that
  states the keys (a WebKit engineer in bug 193825, filed 2019-01-25, still NEW)
  writes that "it doesn't look like UIKit supports a number pad UIKeyboardType
  with a minus key"; two third-party reports speak only of the `decimal` and
  `numeric` pads and of `DecimalPad`. None measures it on a current iOS, and
  Apple's and MDN's pages are silent or say "may or may not". No source gives
  `numeric`, `tel` or `search` a minus key. Per WebKit's source a `pattern` does not
  change what an explicit `inputmode` shows, and `type="number"` with no
  `inputmode` asks for the numbers-and-punctuation keyboard. Which of
  keyboards, Region and Language sets the decimal separator is claimed three ways
  and settled by none. The `Decision — open` options are unchanged and none is
  chosen.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, F1 — "option (a)'s
  premise is not measured, and not scheduled to be". The owner chose the gate's
  first direction (2026-11-01): Build step 1 and Done when 1 now also record the
  alternative keyboards (`inputmode="text"`, `"numeric"`, a `pattern`,
  `type="number"`) on a scratch page, named in Build step 1, so one iPhone
  session prices all four options. `git diff f6485e7b -- <this ticket> | grep -c
  '^-.*opens the production ledger in'` → `1`, and the same for `'^-.*the keypad
  an iPhone showed: the device, the iOS version, and whether it'` → `1`: the two
  removed lines. The _Decision — open_ options are not touched.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, F2 — "it says the lg-89
  builder 'saw the iOS keypad in its own build and could not measure it' …
  'nothing in the keypad column is measured', and the table has no keypad
  column". The first Log entry now says it "raised the question of" the keypad,
  and "nothing about the keypad is measured". `git diff f6485e7b --
  <this ticket> | grep -c '^-.*which saw the iOS keypad in its own build and'` →
  `1`, and `'^-.*nothing in the keypad column is measured'` → `1`.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, F3 — "the table says
  `parseShare` in `web/src/labels.ts` 'matches digits only'. Its pattern also
  takes a decimal part (`.` or `,`) and a trailing `%`". The row now says it
  refuses a sign, and what its pattern takes. `git diff f6485e7b -- <this
  ticket> | grep -c '^-.*matches digits only'` → `1`.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, F4 — "`Done when` 3 says
  the chosen option's check 'is added here as line 3 … Until then this line does
  not exist,' and it is line 3 and does exist". Taken in the gate's second
  direction, the sentence moved into Build step 3, which already says what the
  answer commit writes, and line 3 is deleted: _Done when_ now holds the two
  lines a grader can check at this commit (the readings, and the recorded
  answer), and the answer commit adds the third. `git diff f6485e7b -- <this
  ticket> | grep -c "^-.*When the answer is recorded, the chosen option's check
  is added here as line"` → `1`.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, F1 (remainder, per gate 2) — "Decision (a) still says as fact that "the full keyboard replaces the number pad on those fields for every phone, so every amount is typed more slowly"". The cost sentence is now documented expectation ("as the documentation expects", "would replace", "would be typed"), with row C recorded as the keypad's kind, never its speed; the option's meaning is unchanged. `git diff 961f3d1c HEAD -- <this ticket> | grep -c '^-.*so every amount is typed more slowly'` → `1`.
- 2026-11-01 — Fixed at landing by owner choice: gate 2, N1 — "_Why_ (i) quotes a Xamarin.Forms report as saying the iPhone's `DecimalPad` has no sign key "while the iPad layout does"". The quotation is now the issue's own words, taken as the gate's first direction. `git diff 961f3d1c HEAD -- <this ticket> | grep -c '^-.*"while the iPad layout does"'` → `1`.
- 2026-11-01 — Fixed at landing by owner choice: gate 2, N2 — "_Why_ (iii) puts quotation marks round "a keyboard with only digits, a decimal separator, and +/-" as the forum answer's words". It now quotes the answer's words, "would be better to have just digits, separator and +/-", and says the thread was read through `WebFetch`. `git diff 961f3d1c HEAD -- <this ticket> | grep -c '^-.*negative, and adds that "a keyboard with only digits'` → `1`.
- 2026-11-01 — Fixed at landing by owner choice: gate 2, N3 — "the one unverified premise of Build step 1 has no evidence behind it, where the text credits it with some. The label sits in _Why_ and not at Build step 1". _Why_ (iii) now says the comment names neither Safari nor typing and reports no result; Build step 1 carries the "Unverified" label and gives `http://<the computer's address>:8000/keys.html` for the served page. `git diff 961f3d1c HEAD -- <this ticket> | grep -c '^-.*tests on an iPhone with a'` → `1`.
- 2026-11-01 — Fixed at landing by owner choice: gate 2, N4 — "_Why_ (iii) and the second Log entry restate it flat, "bug 193825 says UIKit has no number pad with a minus key", and the Log gives "two third-party reports" the same sentence". Both places now quote the engineer's hedge, and the Log says the two reports speak only of the `decimal` and `numeric` pads and of `DecimalPad`. Two removed lines, each counted: the second grep is `'^-.*two third-party reports) say UIKit'` and also gives `1`. `git diff 961f3d1c HEAD -- <this ticket> | grep -c '^-.*bug 193825 says UIKit has no number pad with a minus key'` → `1`.
- 2026-11-01 — Fixed at landing by owner choice: gate 2, N5 — "_Why_ (iii) calls the two issues' authors "the two library maintainers" who "reached for" `inputmode="text"`". _Why_ (iii) now names a maintainer's comment on #372 and the user who opened Mantine #9370; _Why_ (i) now says the Mantine issue is opened by a user, gives no source for its keypad claim, and that its "evident from the source" sentence concerns a prop-ordering regression. The Mantine reporter's request for `inputmode="text"` was read from the issue (`WebFetch`, 2026-11-01), not taken from the gate. `git diff 961f3d1c HEAD -- <this ticket> | grep -c '^-.*the two library maintainers above reached for'` → `1`.
- 2026-11-01 — Fixed at landing by owner choice: gate 2, N6 — "_Why_ (ii) concludes "on a current iOS `numeric` is documented as digits only" and the Log says "`numeric`, `tel` and `search` are not candidates" ... Reword the Log to the bullet's wording". The Log now says "No source gives `numeric`, `tel` or `search` a minus key", the bullet's wording. The _Why_ (ii) sentence is not among the lines the gate told me to change. `git diff 961f3d1c HEAD -- <this ticket> | grep -c '^-.*are not candidates. Per WebKit'` → `1`.
- 2026-11-01 — Fixed at landing by owner choice: gate 2, N7 — "Build step 1's new first sentence says "One session prices all four options"". It now reads "One session prices options (a) and (d)", the gate's first direction. `git diff 961f3d1c HEAD -- <this ticket> | grep -c '^-.*One session prices all four options'` → `1`.
- 2026-11-01 — Fixed at landing by owner choice: gate 2, N8 — "`Done when` 1 does not grade three things Build step 1 asks for: the Rebate field's reading once #717 has merged ..., which delivery was used ..., and each row's confirm-or-refute against the documentation". `Done when` 1 now asks for all three, taken as the gate's first direction ("Add them"). `git diff 961f3d1c HEAD -- <this ticket> | grep -c '^-.*not measured is named as not measured'` → `1`.
- 2026-11-01: the review record for this filing is PR #718's thread, not a `## Review`
  section here. Gate 1's full report is at
  https://github.com/brunolabbe/tools/pull/718#issuecomment-6558993188, and gate 2's at
  https://github.com/brunolabbe/tools/pull/718#issuecomment-6558993946. The pull request
  only files this ticket, so it has no `--land`; status stays `needs-decision`.
