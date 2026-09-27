# Roadmap — ledger

A household ledger replacing a spreadsheet. Two people share one Desjardins
account; money arrives in it as transfers earmarked for buckets, leaves it as
bills and card purchases, and the spreadsheet's real job is answering who has
paid their share of what.

This page is thin on purpose, as the planner's was at the same age. Nothing
below Phase 1 is designed yet, and a phase written in detail before its
analysis exists is a guess the next agent inherits as a plan.

---

## What the owner has decided

Answers given on 2026-09-27, before any code. They are the premises
`00-ANALYSIS.md` starts from rather than questions it reopens, and it holds the
detail and the numbers behind each.

- **Two buckets, two splits.** The mortgage bucket is split 50/50. The
  shared-expenses bucket is split by the ratio of the two salaries.
  - _Amended later on 2026-09-27:_ the salaries **are** stored, dated by year,
    and the ratio is derived from them. The owner wants their history charted.
  - The earlier answer had been to store the percentage only.
  - The ratio is still stored alongside the salaries, with its effective date,
    so a past settlement stays recomputable.
- **Each deposit is one transfer to one bucket.** So a rule classifies a whole
  row, from its description and its amount; a deposit is never split across
  buckets.
- **Receipts arrive both ways.** One paid on the joint account's card is matched
  to the imported row it explains. Shared spending on a personal card is
  gathered in **periods**, as the spreadsheet does, and closing a period
  computes what to deposit into the joint account.
- **History is imported once, all of it since 2022.** A one-off importer reads
  the existing Excel file. The real file stays out of the repository; its
  fixtures are synthetic.
- **The mortgage bucket is not shared money.** Each person's own part is their
  deposits minus half of every payment, and the two parts are the whole
  balance. Who has paid extra, and how much, is the view's headline.
- **Settlements go into the buffer, sized by the matching rule.** Whoever is
  short tops up until the two contributions stand at the ratio. It is computed
  cumulatively, since the last point where the two were even.
  - This replaces the workbook's current formula, which is right only for a
    direct payment.
  - A catch-up for the past folds into the open period.
- **History is imported as it happened.** The two historical settlement formulas
  are kept, each with a note on its row, and an owner's correction is also a
  note, never a silent rewrite.
- **Everything keeps its history, and there are stats.** Salaries, ratios,
  mortgage payments, balances and spending by category are all charted.
  Nothing is overwritten.
- **Receipts are read locally first.** Free local OCR reads the totals and
  taxes, and a model is called only when the arithmetic fails or items or
  categories are wanted. This is pending a measurement on real receipts, which
  is lg-8's first step.
- **Receipts are read line by line.** Items that are not shared come off,
  together with their taxes and deposits, and the code computes that part, not
  the model. An item can also be marked as the _other_ person's, which makes it
  a charge they owe in full. Items are categorised for the stats.
- **Both people use it, identified by Cloudflare Access** — two addresses on one
  policy, and no login of the tool's own.

## Phase 0 — Scaffold ✅

The seams, and no domain: `contract` with an empty error catalog, `api` with
health and the served bundle, a `web` shell, an `e2e` project with no spec, the
image and its gate, the release entry, and the deployment fragment and Access
policy. See [`CLAUDE.md`](../CLAUDE.md) for the layout.

## Phase 1 — The analysis ✅

[`00-ANALYSIS.md`](./00-ANALYSIS.md) was written from a real AccèsD paste and
the real workbook, both read and neither committed. It settles:

- the paste's shape (§2);
- what the running-balance chain proves (§2);
- the rules' form (§3);
- what "who owes what" is computed over (§4–5);
- a receipt's lifecycle and the model's limits (§6);
- the Access identity (§7);
- the import (§8).

**Still open:** what a pending row and a joint-account card purchase look like
in a paste. Neither was in the sample, and lg-1 refuses both by name until a
sample shows them.

`01-ARCHITECTURE.md` is not written yet. The tickets carry the structure they
need, and the page arrives when two tickets would otherwise repeat it.

## Phase 2 — Replace the account sheet

The paste, the rules and the two bucket views. At the end, a paste replaces
transcribing by hand.

| Ticket                                                   | What                                     |
| -------------------------------------------------------- | ---------------------------------------- |
| [lg-1](./work/lg-1-parse-an-accesd-paste.md)             | parse a paste, proved by its own balance |
| [lg-2](./work/lg-2-store-a-pasted-statement.md)          | store it, chained onto what is stored    |
| [lg-3](./work/lg-3-verify-the-access-identity.md)        | verify the Access token                  |
| [lg-4](./work/lg-4-rules-and-the-inbox.md)               | rules, and the inbox                     |
| [lg-5](./work/lg-5-people-ratios-and-the-two-buckets.md) | salaries, ratios, and the two buckets    |

## Phase 3 — Replace the period sheets, and retire the workbook

| Ticket                                                     | What                                   |
| ---------------------------------------------------------- | -------------------------------------- |
| [lg-6](./work/lg-6-periods-and-the-matching-settlement.md) | periods, closed with the matching rule |
| [lg-7](./work/lg-7-import-the-workbook.md)                 | import the history since 2022          |

## Phase 4 — Receipts

| Ticket                                                           | What                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| [lg-8](./work/lg-8-receipts.md)                                  | measure, read locally or with a model, file            |
| [lg-10](./work/lg-10-receipt-items-exclusions-and-categories.md) | items: not shared, or charged to the other; categorise |

## Phase 5 — History and stats

| Ticket                                   | What                           |
| ---------------------------------------- | ------------------------------ |
| [lg-9](./work/lg-9-history-and-stats.md) | the charts, over every history |
