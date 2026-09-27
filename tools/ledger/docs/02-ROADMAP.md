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
  shared-expenses bucket is split by the ratio of the two salaries — and only
  the **percentage** is stored, with the date it takes effect, never the
  salaries themselves.
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
- **Both people use it, identified by Cloudflare Access** — two addresses on one
  policy, and no login of the tool's own.

## Phase 0 — Scaffold ✅

The seams, and no domain: `contract` with an empty error catalog, `api` with
health and the served bundle, a `web` shell, an `e2e` project with no spec, the
image and its gate, the release entry, and the deployment fragment and Access
policy. See [`CLAUDE.md`](../CLAUDE.md) for the layout.

## Phase 1 — The analysis

`00-ANALYSIS.md`, and it cannot be written from the armchair: it rests on **a
sample AccèsD paste** and **a copy of the Excel file**, both from the owner, both
read and neither committed. What it has to settle, at least:

- the paste's real shape — columns, date and amount formats, the running
  balance, and what a pending row looks like — and what the parser refuses;
- what the running-balance chain proves, and what a break in it means to a user;
- the classification rules' form, and who edits them;
- what "who owes what" is computed over — per bucket, per year, since forever —
  and how a split's effective date applies to rows either side of it;
- a receipt's lifecycle, matched and out-of-pocket, and what the model is and is
  not trusted to read;
- how the API reads the Access identity, and what it does with a request that
  has none — the loopback port bypasses Access entirely.

`01-ARCHITECTURE.md` follows it, and so do the planned `books` and `receipts`
packages. The tickets come out of both.
