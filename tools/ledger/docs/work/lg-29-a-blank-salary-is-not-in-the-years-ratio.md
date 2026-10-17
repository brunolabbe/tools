---
id: lg-29
tool: ledger
title: A blank salary means the person is not in that year's ratio
kind: work-package
status: ready
milestone: P6
depends_on: [lg-23]
difficulty: standard
---

# lg-29 — A blank salary means the person is not in that year's ratio

## Why

lg-23 lets a household hold any number of people. A name stays in the books for
good, even after its last address is removed (`docs/00-ANALYSIS.md` §7). But the
salaries screen (`web/src/salaries/Salaries.tsx`, `save`) still asks for a salary
from every person the books name, the one who left included. Today the only way
to leave someone out of a year's ratio is to enter 0. They then stay among the
ratio's people with a share of zero, and that is what lg-23's "people change
only at a close" check compares.

lg-23's builder raised it, and the owner answered on 2026-10-17 through
`AskUserQuestion`. The owner chose this over "Leave as is", then kept the choice
when asked again against the gate's alternative below.

### The decision

**Chosen: a blank salary means "not in this year's ratio".** The form sends only
the salaries it was given. The ratio it proposes is between those people.

**This changes what a blank means.** Today a blank is an error ("alex's salary is
not an amount"), and that error catches a salary forgotten by mistake. After this
ticket, a forgotten salary silently leaves that person out of the proposal. The
proposal's shares are on the screen before anyone confirms, and that is the only
check left.

**Rejected:** list only the people who currently hold an address on the
salaries form, and enter 0 for anyone else in the meantime. lg-23's gate 1
recommended it. It would keep a blank an error, but the form's list would then
depend on the directory rather than the books.

## Build

1. `web/src/salaries/Salaries.tsx`: a person whose salary field is blank is left
   out of the entry. A field that holds text that is not an amount is still
   refused, as now. Refuse the entry when fewer than two salaries remain.
2. Say on the screen that a blank leaves the person out of the year's ratio.
3. The API needs no change: `enterSalaries` takes any subset of the household's
   people, and `proposalFor` proposes for two or more (lg-23). Check that it
   still holds.

## Done when

1. A web test: with alex, casey and sam on the form and sam's field blank, the
   entry sent names alex and casey only, and the proposal shown is between them.
2. A web test: a field holding text that is not an amount is still refused, and
   nothing is sent.
3. Gates green.

## Log

- 2026-10-17 — Filed by lg-23's builder in round 1, from the owner's answer.
