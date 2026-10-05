# What the spreadsheet actually does — and what the ledger has to do instead

The ledger replaces a spreadsheet two people have kept by hand since 2022 for the
joint Desjardins account they share. This page is the research the design rests
on. It was written from **a real AccèsD paste and the real workbook**, both read
outside the repository and neither committed. Every name, caisse, lender and
amount below is invented, and every ratio is a round stand-in. The shapes are
real, and so are the counts.

`02-ROADMAP.md` lists what the owner decided. This page explains why each
decision is right, and supplies the arithmetic the tickets build.

---

## 1. Two systems in one workbook

The workbook turned out to hold two separate systems, and the tool has to replace
both.

**The account ledger.** There is one sheet per year, a transcription of every
movement on the joint account. Each row is assigned to one of two **buckets**:

| Bucket                              | Split                       | Money in                          | Money out                                    |
| ----------------------------------- | --------------------------- | --------------------------------- | -------------------------------------------- |
| Mortgage (`Hypothèque`)             | 50/50                       | each person's recurring transfer  | the mortgage payment, every two weeks        |
| Current expenses (`Dép. Courantes`) | by salary ratio, e.g. 60/40 | tax contributions and settlements | municipal and school taxes, house work, fees |

**The period sheets.** There are five so far, each covering three to four months:
`$ (Avril-Août)`, …, `$ (Juin - Septembre)`. Each sheet records **shared spending
paid on each person's own card**, with one column per person. That spending falls
into two kinds:

- **fixed monthly items**, entered as amount × months: home insurance, Internet,
  a streaming service minus one person's own share, and electricity bills;
- **purchases**: groceries, the house, trips.

When a period closes, the sheet computes a `Montant à déposer`. Whoever put in
less than their ratio share deposits it **into the joint account's
current-expenses bucket**. That deposit then shows up in the next paste as an
ordinary transfer, and the year sheet records it with a note such as
`Équivalence mars - juin`.

So the current-expenses bucket is the **buffer**. It is funded by those
settlements and by tax contributions made at the ratio, and it pays for the
occasional larger shared purchase. That role is what §5 turns on.

## 2. The AccèsD paste

The owner selects the transaction table in AccèsD and pastes it. The real sample
covered three months: 25 rows. This is its shape, with invented content:

```
Septembre 2026
Date	Description	Montant	Solde	lien
12 SEP12 Septembre
Loyer/Prêt hypothécaire
Hypothèque /Prêteur Exemple

−700,00 $	2 100,00 $
12 Septembre Hypothèque /Prêteur Exemple −700,00 $
11 SEP11 Septembre
Virements
Virement entre folios /Caisse du Lac

+400,00 $	2 800,00 $
11 Septembre Virement entre folios /Caisse du Lac +400,00 $
Total	−300,00 $
```

What the parser has to know:

- **A month header is the only place the year appears.** A row's date line reads
  `12 SEP12 Septembre`: the day, the abbreviated month glued to the day again,
  then the full month name. The sample showed `JUL`, `AOÛ` and `SEP`; the other
  abbreviations are unverified, and `FÉV` and `DÉC` in particular.
- **Each row takes six lines:** the date, Desjardins' own category, the
  description, a blank line, `amount⇥balance⇥`, and then an **echo line** that
  repeats date, description and amount. The parser reads the first five and
  cross-checks them against the echo.
- **The minus sign is U+2212**, not a hyphen, and credits carry an explicit `+`.
  The thousands separator came through as a space. The real clipboard probably
  carries U+00A0 or U+202F, so the parser accepts any whitespace there.
- **Rows are listed newest first, and so are rows on the same day.** The sample
  had four rows on one day, and only the listed order recovers their sequence.
  **The parser must never sort by date.** Sorting would break the chain below,
  and nothing else can tell those four rows apart.
- **Each month ends with a `Total` line.**

**The running balance is the proof.** Each row's balance equals the previous
row's balance plus its own amount. On the sample this held for all 25 rows with
zero breaks, across two month boundaries and through the same-day group. The
month totals also equalled the sum of their rows. That gives the parser three
independent checks it gets for free: the chain, the month totals and the echo
lines. A paste that fails any of them is refused with the row named, never
imported "mostly".

**A paste also chains onto what is already stored.** A new paste's oldest row
has to continue from the newest stored row's balance, or overlap with it. A gap
means missing rows, and the user is told how much money went unexplained, not
merely that something went wrong.

**A row has no identity of its own.** Its date, description, amount and balance
describe it, but they are not unique: a transfer, its reversal and the same
transfer again on one day (+10,00, −10,00, +10,00) put the balance back where it
was, so the first and third rows repeat all four fields. A paste is therefore
matched to the stored rows by _position_: its oldest rows are the stored tail's
last rows, field for field, or it opens from the stored tail's balance. Pastes
routinely overlap, so re-importing rows is a no-op. Where one paste can be read
both as rows already stored and as new rows, it is refused and a longer stretch,
starting on an earlier row, is asked for.

Not yet seen, and each needs a sample before its parsing is written:

- a card purchase on the joint account (the receipts in §6 match against these);
- a pending row;
- a month with an accented abbreviation.

## 3. Classifying rows

Every row goes into exactly one bucket, and every deposit belongs to one person.
The owner confirmed that a transfer is never split across buckets.

The paste already carries what classification needs:

| Pattern                                                                               | Means                                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| suffix after `/` on a transfer                                                        | the **source caisse**, which identifies the person                             |
| `Virement entre folios` vs `Virement - AccèsD Internet`                               | which of their transfers it is, which separates the two buckets for one person |
| a fixed amount                                                                        | the other person's recurring mortgage transfer                                 |
| Desjardins' category, e.g. `Loyer/Prêt hypothécaire` or `Taxes municipales/scolaires` | which bucket a payment leaves from                                             |

So a **rule** is data: a description pattern, an optional exact amount, and the
person and bucket it assigns. A row that matches a rule **exactly** is
classified; anything else lands in an **inbox** with the nearest rule suggested.
A transfer that differs from its usual amount is a question, not a guess. The
workbook shows why: one recurring mortgage transfer was once filed under current
expenses by mistake, and the owner caught it only when this analysis asked.

Rules belong in the database, edited by both people, and never in the
repository. Caisse names identify a household.

## 4. The mortgage bucket

The mortgage is split 50/50. The workbook compares **cumulative deposits since
2022**, person against person. It shows the difference between the two totals,
and calls whatever the bucket holds beyond that difference common surplus.

**The owner corrected that: the mortgage bucket is not shared money.** Unlike
the buffer (§5), nothing in it belongs to both people. Every dollar in it is one
person's deposit that no payment has used yet. Knowing who has paid extra, and
how much, is the point of the view. So the tool attributes the whole balance:

```
own_A = deposits_A − ½ × payments
own_B = deposits_B − ½ × payments
own_A + own_B = the bucket's balance
```

The workbook's gap is `own_A − own_B`, and it falls out of the model. On the
real file, all three rows of that model held exactly since 2022, and the bucket
held no row that was neither a deposit nor a payment. The model has no "common"
part.

The mortgage view leads with **each person's own money in the bucket** and who
is ahead by how much. It is recomputed from rows on every read and never
stored.

The two schedules differ on purpose: one person transfers every two weeks and
the other monthly. So the gap moves within a year by design, and the view shows
it as a running line, not a verdict.

## 5. The settlement formula

This is the part the workbook had wrong twice, in two different ways.

### What "fair" means here

Shared costs are split by the ratio _r_ : (1 − _r_). The buffer pays for shared
things, so **money in the buffer is itself shared money, owned at the ratio**.
Whatever goes into it therefore has to go in at the ratio too. Otherwise part of
a settlement stays with the person who paid it.

### Formula v2, the one in use since late 2025, under-asks

```
owed_A = r × (A + B) − A          (A, B: what each spent on their own card)
```

This is the right amount **for a direct payment to the other person**. Paid into
the buffer, only (1 − _r_) of it reaches the person who was owed, because _r_ of
it is still the payer's share of shared money. The owner tested this against a
simulation, with _r_ = 0.6:

| Setup                       | Figures                                     |
| --------------------------- | ------------------------------------------- |
| Buffer at the start         | 1 000, funded at the ratio                  |
| This period's card spending | B bought 100 of groceries, A bought nothing |
| Afterwards                  | the buffer buys a 500 snowblower            |
| Fair outcome                | A bears 360, B bears 240                    |

| A settles by                              | A bears | B bears | error         |
| ----------------------------------------- | ------- | ------- | ------------- |
| depositing 60 into the buffer (v2)        | 324     | 276     | B overpays 36 |
| paying 60 to B directly                   | 360     | 240     | exact         |
| depositing 60 ÷ 0.4 = 150 into the buffer | 360     | 240     | exact         |

### The matching rule, which the tool uses

Whoever is short tops up until the two contributions stand at the ratio:

```
deposit_A = max(0, B × r / (1 − r) − A)
deposit_B = max(0, A × (1 − r) / r − B)
```

For example, if B spent 100 and _r_ = 0.6, A deposits 150, and 150 : 100 is
exactly 60 : 40. This equals v2's amount divided by the other person's share.
The extra is not lost: it is the payer's own share of the buffer, and it will
pay for their part of the next shared purchase.

### Formula v1, in the first two period sheets, had the right idea

```
deposit_A = B / r − A             (should be B × r / (1 − r) − A)
```

v1 was already a matching rule: bring the smaller contribution up to the ratio.
It used the wrong multiplier. For _r_ = 0.6 it multiplies by 1/_r_ ≈ 1.67
instead of _r_ / (1 − _r_) = 1.5, and in the other direction by the wrong ratio
altogether. So v1 asked somewhat too much, and v2 then corrected in the wrong
direction and asked far too little. The owner decided to **import both
historical settlements as they happened**. Each gets a note on its row; nothing
is rewritten.

### Cumulative, not per period

Per-period matching is exact only if every earlier period was settled exactly,
and history was not. So the tool computes over **everything each person has put
toward shared costs since a point where they were even**:

- card lines from the periods;
- **every deposit** into the current-expenses bucket, including tax
  contributions, settlements and corrections.

Then it applies the matching rule to the two totals. Payments out of the buffer
never enter the calculation, because their money was already counted when it
went in. Tax contributions made at exactly the ratio come out neutral. A
contribution that was off, such as a tax transfer entered wrong and corrected
months later, is absorbed with no special case.

On the real file, starting from the settlement that preceded the first period
sheet, this produced a **catch-up** owed by one person. Two computations agreed
within 12 cents: the exact cumulative one, and per-period matching plus the
catch-up. The 12 cents is a tax contribution 10 cents off the ratio. The owner
decided to **fold the catch-up into the open period**, so closing that period
settles both with one deposit.

### Charges between the two

Sometimes one person pays for something that is entirely the other's: an item
on a shared receipt, or a purchase made as a favour. The owner asked for that
to be recorded as a **charge**. The other person owes its full price,
including its taxes and deposit, and it is not shared at all.

A charge is money owed **directly** from one person to the other. So is the
shared imbalance that formula v2 computes. That gives one rule for the whole
settlement:

```
net = [r × (A + B) − A] + (charges A owes B) − (charges B owes A)
      (A, B cumulative as above; net > 0 means A owes B)

paid into the buffer:  A deposits net / (1 − r),  or B deposits −net / r
paid directly:         the same net, as a transfer between the two
```

**The matching rule is this rule with no charges.** Dividing by the
recipient's share is what makes a deposit into shared money worth exactly the
debt to the person it settles. The rule was checked by simulation: across five
random mixes of card spending and charges in both directions, each person's
cash out, minus their share of the buffer, equalled exactly what they consumed.

A settled charge needs no special case later. The deposit that settled it
enters the payer's cumulative contributions, and it cancels there against the
charge, which also stays in the sums.

### Numbers

- **Money is integer cents.**
- **Salaries are stored, and the ratio is derived from them.** Each salary
  record is dated, and each ratio is kept in parts per million with the date it
  takes effect. The owner asked for this so the history can be charted (§9).
  The ratio is stored as well as derived because a settlement must be
  recomputable with the ratio it actually used, even after a salary record is
  corrected. Parts per million are needed because the owner's ratio has four
  significant decimals of a percent, which basis points would round away.
- **Rounding happens once,** half-up to the cent, on the final deposit. It never
  happens on an intermediate value.
- **A ratio change takes effect at a period boundary.** Whatever is owed across
  the boundary carries over as an amount of money, so it does not change when
  the ratio does.

## 6. Receipts and periods

Periods stay, because the owner chose to keep the workbook's rhythm. What changes
is what feeds them:

- **Purchases on a personal card** are receipts. A photo is taken on a phone, a
  model reads the merchant, date, total and taxes, and the person confirms. It
  becomes a line in the open period for **whoever took the photo**, identified
  by Access (§7).
- **A purchase on the joint account's card** is matched to its pasted row by
  amount within a date window, and the person confirms. It documents the row and
  is not a period line, since the money already left the buffer.
- **Fixed monthly items** become recurring entries: an amount, a payer and a
  start date. They generate one dated line per month, so a period contains
  exactly the months it covers. The workbook computed months with
  `TRUNC(YEARFRAC(...) * 12)`, which drops fractions, and its older sheets used
  `MONTH(end) − MONTH(start)`, which fails across a new year. Two period sheets
  also overlap by 53 days, because one start date was typed wrong. Dated lines
  remove all three problems.

### Items that are not shared

A shared grocery run often includes something only one person pays for. The
owner's example is beer, where the other person should not share its price, its
taxes or its bottle deposit. So a receipt is read **line by line**, not just as a
total:

- each item's printed price, and whether it is marked taxable (Québec receipts
  flag taxable lines with a code);
- each deposit line (`consigne`), tied to the item it follows;
- the subtotal, each tax, and the total.

The person taps the items that are not shared. **The code, not the model,
computes what comes off.** That is each excluded item's price, its deposit, and
its GST and QST at the rates in effect on the receipt's date. The rates are
dated configuration, because they change. The shared amount is the total minus
that, so it always reconciles with what was paid.

Taxes printed on a receipt are computed on the subtotal, so recomputing one
item's share can differ by a cent. The excluded part is rounded once, half-up,
and the shared part takes the remainder. **The read lines must add up:**
items + deposits + taxes = total, to the cent. If they don't, the receipt is
shown for correction, never filed on the model's word.

An item has three possible states:

- **shared**, which is the default;
- **not shared**, which stays with whoever paid;
- **the other person's**, which becomes a **charge** for its full price plus
  its taxes and deposit (§5, _Charges between the two_).

The owner asked for all three.

### Categories

The owner wants to see spending by type: groceries, alcohol, household,
pharmacy, restaurants. The model **proposes** a category per item from a fixed,
editable list, and the person confirms or changes it. A merchant the person has
categorised before gets that category proposed first. Categories feed the stats
(§9) and nothing else. They never change who owes what.

### Who reads the receipt: local OCR first, a model when needed

The owner asked whether this needs AI at all. A survey on 2026-09-27 (web
research only; nothing was run on a real receipt yet) found:

- **Free, CPU-only npm OCR exists.**
  - `ppu-paddle-ocr` (MIT, a PaddleOCR port on onnxruntime, with a Latin model
    that covers French) was the strongest candidate.
  - `tesseract.js` (Apache-2.0) is the classic. It is noisier on long receipts:
    one benchmark put its character error rate on CORD receipts at 0.80,
    against 0.48 for PaddleOCR.
  - `scribe.js-ocr` is AGPL, which would bind this repository's licence, and
    `ocrad.js` is dead. LayoutLM and LayoutXLM are licensed non-commercial.
    Donut would need hundreds of labelled Québec receipts.
  - **No published benchmark covers French or Québec receipts.**
- **What local OCR plus a hand-written Québec parser gets right** is the
  subtotal, GST, QST and total. They sit on keyword lines, and the arithmetic
  checks them: GST at 5 %, QST at 9.975 %, and the parts summing to the total.
  A misread is therefore detected, not filed.
- **What it gets wrong** is item names (often garbled), item prices on faded
  paper, and above all the one- or two-character taxable codes at the line's
  edge. Those codes are exactly what excluding an item needs. It also cannot
  categorise.
- **Vision models are good, but not perfect either.** One study put frontier
  models at 82–87 % field accuracy on scanned receipts. The reconciliation
  check stays whatever reads.

**Decided by the owner: measure first, then most likely a hybrid.**

- The first step of lg-8 runs 10–20 of the household's real receipts through
  `ppu-paddle-ocr`, `tesseract.js` and a Claude model on the target machine.
  It records accuracy per field, time and cost, and the owner picks with the
  numbers.
- The expected outcome is a hybrid. Local OCR reads every receipt's totals and
  taxes, for free and without the photo leaving the house. A model is called
  only when the arithmetic fails, or when the person wants items (to exclude
  or charge one) or categories.

### What a reader is trusted with

Whether it is OCR or a model, a reader turns printed text into fields, and a
model may also propose a category. A person confirms both. No reader decides
whether an item is shared, computes a share or a tax, or files anything.

**The photo leaves the house only when a model is called.** The screen says so
at that moment, not in a notice on the capture screen that nobody rereads.

## 7. Identity

Both people reach the tool through Cloudflare Access, with two addresses on one
policy. Access puts the identity in a signed header
(`Cf-Access-Jwt-Assertion`). The API **verifies that token** against the team's
signing keys, and does not merely read the plain email header beside it, because
anything that reaches the origin without passing through Access can forge the
plain one. The scaffold's own note is the case: the loopback port bypasses Access
entirely.

- **A request with no valid token** gets a 401 on every route except
  `/api/health`.
- **Development** sets a fixed identity through configuration, which the
  production image refuses.
- **The email-to-person mapping** is configuration, never a table seeded from
  the repository.
- **A name in `ACCESS_PEOPLE` is permanent.** _Decided by the owner on
  2026-10-05, in lg-5._ The books name people by that name: lg-4 stores it on
  rules and classifications, and lg-5's `people` table holds every name the
  configuration has ever used, and the person ids already stored on rules and
  classifications, and nothing else. Nothing removes one, so a renamed or
  departed person stays a person: listed by `/api/people`, asked for on the
  salaries screen, and given a share of the mortgage's joint rows.
  Changing an address is safe; changing the name it maps to is not. Retiring a
  person is future work, for when someone first needs it.

## 8. The one-off import

The workbook holds everything since 2022, and the owner chose to import all of
it. Its layout:

| Sheets          | Contents                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2022` … `2026` | the account, newest first. `B` date, `C` bucket, `D` detail (from `Labels`), `E` person, `F` running balance, `G` amount, `H` note. Each year ends in two `Solde reporté` rows carrying the buckets over |
| `$ (…)` periods | row 1 names the two people, row 6 holds the period's start and end dates, and rows 8 onward hold one line per item, with one amount column per person and a note                                         |
| `Accueil`       | the salaries the ratio came from, imported as the ratio's first record, and the only salaries the workbook holds                                                                                         |
| `Labels`        | the vocabulary: persons, buckets and details                                                                                                                                                             |
| `Budget`        | a monthly budget, deferred (§10)                                                                                                                                                                         |

What the importer does with that:

- **It reads cached cell values, never formulas,** except to note that a cell
  was computed.
- **It verifies before it writes:**
  - every `Solde reporté` equals the previous year's closing balance (it did on
    the real file, all four years);
  - the combined balance equals the paste's balance on the same day (it did);
  - for the months a paste also covers, the rows match one for one (25 of 25,
    with one date a day off).
- **It repairs, and says so.**
  - Twelve rows carry a mistyped year, as far off as 2014. The row order proves
    the sheet's own year, so the importer takes the year from the sheet name.
  - Rows with no amount are placeholders and are skipped.
  - A row with no person is joint: rebates, sales of shared things, error pairs.
- **Owner corrections come from a side file** kept outside the repository, such
  as moving a row to the other bucket. Each correction lands with a note on the
  row. Nothing is silently rewritten.
- **The result is a report:** rows imported, repaired, skipped and corrected, and
  the two cumulative figures (each person's own money in the mortgage
  bucket, and the catch-up) set against what
  the workbook shows.

## 9. History and stats

The owner wants the history of everything, and charts of it. The design
already allows that, because every number the tool shows is computed from
dated rows and nothing is kept as a running total:

- **The mortgage payment over time.** The workbook already charts it, as a line
  chart on its `Hypothèque` sheet. The payment changes at each renewal, and the
  rows show exactly when.
- **The ratio and the salaries over time**, from their dated records.
- **Each person's cumulative contributions**, per bucket, and each person's own
  money in the mortgage bucket as a line.
- **The buffer's balance over time**, with what paid for each large drop.
- **Spending per period and per category**, down to the receipt item: how
  much went to groceries or to alcohol, and the fixed items' cost month by month.
- **Each settlement**: its date, its amount and the formula version that
  produced it. The imported history carries two different formulas, and the
  chart should show that.

**The one rule that makes this possible is never to overwrite.** A corrected
salary, a reclassified row and a re-read receipt are each a new record that
supersedes the old one, never an edit in place.

## 10. Scope

- **No bank connection.** Paste only. AccèsD has no API a household can use, and
  scraping it would put banking credentials in this tool.
- **Not a budget.** The workbook's `Budget` sheet is deferred until someone asks
  for it.
- **Not accounting and not tax.** The receipts' taxes are read because they are
  printed, not because anything files them.
