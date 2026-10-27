---
id: repo-132
tool: repo
title: An event ledger tested by event studies on oil, gold and the S&P, parked at the spike
kind: work-package
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# repo-132 — An event ledger tested by event studies

## Why

The owner's idea, raised 2026-10-26: save major world events in a database and
look for patterns that give clues about moves in petrol, gold and the stock
market before they happen. Discussed in one session, pre-registered below, and
parked by the owner before any number was run. This ticket is the resume point,
so that an agent without that session's context can pick it up. It is filed
under `repo-` because no tool directory exists yet, and none should until the
spike in Build 1 shows the premise holds.

**The framing the discussion settled on.** A database of past events cannot
anticipate the move an event causes: prices react within minutes, and the
events that precede their effect are the scheduled ones, where only the surprise
against consensus moves anything. What a household tool can do is an **event
study**: for each event, measure the series' abnormal return over three windows
and compare them.

| Window        | What it measures                                       |
| ------------- | ------------------------------------------------------ |
| day -10 to -1 | anticipation: the market saw it coming                 |
| day 0 to 1    | instant repricing: never usable                        |
| day 2 to 20   | slow burn: the one part that can still be ahead of you |

The second product the discussion found honest is a **forecast journal**: log
the event, hide the chart, record what you expect each series to do over one,
five and twenty days, and score it later. That kills hindsight bias by
construction and is the only thing a market cannot give the owner. It is not
pre-registered here; it is a candidate for the tool's analysis document if the
spike earns one.

## Decision — open

**Whether to spend the spike at all.** The owner parked the idea at the point
where the next step was a review of the curated event list. The options, as
asked on 2026-10-26:

- **Review the event list first.** An agent curates about 45 events across the
  seven categories with both dates, and the owner vetoes entries that break the
  inclusion rules before any number is run. This was the owner's pick before
  parking.
- **Run the spike directly.** Curate and compute in one session; the owner
  reads the result.
- **Drop it.** Mark this ticket `dropped`.

Rate the work as `standard` once answered: the method is stated, but curating
events by rule rather than by memory needs judgement.

## Build

Everything below is **pre-registered**: it was written before any data was
looked at, and the spike reports whether each expectation held, failed or had
too few events to say. The spike does not tune an expectation after seeing the
data. A failed expectation is replaced by a new written one, tested only on
events that arrive after it was written.

1. **The spike, throwaway, in the scratchpad.** Nothing under `tools/`. Pull
   the four daily series from 2002, curate the events, compute the three
   windows per event, and report one table per category and series with mean,
   median, spread, count and sign agreement, plus a chart of the stacked
   windows. Period 2003 to 2025.

2. **Series and sources, probed from the devcontainer on 2026-10-26.** All
   daily from 2002.
   - WTI: FRED CSV, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILWTICO`.
   - Brent: FRED CSV, id `DCOILBRENTEU`.
   - Gold: Yahoo chart API, symbol `GC=F` (COMEX front-month futures, a
     US-hours close, not the London fix). Roll-day artefacts are small and the
     standard-deviation scaling absorbs them.
   - S&P 500: Yahoo chart API, symbol `^GSPC`.
   - Yahoo needs explicit `period1`/`period2` epoch seconds and `interval=1d`;
     `range=max` silently coarsens to monthly for gold and quarterly for the
     index. A browser `User-Agent` was sent.
   - Dead ends: FRED's LBMA gold ids are retired (404), FRED `SP500` carries
     ten years only, Stooq returns a bot challenge, LBMA's JSON returns 403.

3. **The computation.** Daily log returns. Normal return is the mean over the
   120 trading days ending 30 days before day 0. Abnormal return is actual
   minus normal; cumulative abnormal return is the sum over a window; divide
   by the estimation window's daily standard deviation so oil and gold are
   comparable. Average per category, keeping spread and count.

4. **Rules for logging an event.**
   - One category per event, decided by the mechanism at the first signal,
     never by what the price did.
   - Two dates: the **first-signal** date, the first day the event was on a
     front page as a possibility, and the **event** date. They coincide for an
     instant event. A scheduled decision has only the event date, plus the
     consensus expectation and the actual.
   - Day 0 is the first trading day on which all four series could react; a
     weekend or after-close event takes the next trading day.
   - Logged by rule, not memory: an event that meets a category's rule goes
     in even if it is remembered as a non-event for prices.
   - An event within 20 trading days of another is kept and flagged
     `overlapping`; report with and without flagged events, and with and
     without 2008 and March 2020.

5. **The seven analysed categories.** About seven events each.

   | Category          | Inclusion rule                                                                        | Examples                                                                | Registered expectation                                                            |
   | ----------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
   | Oil supply shock  | A disruption reported as removing supply, or sanctions on a producer taking effect    | Abqaiq 2019, Suez 2021, Katrina 2005, Libya 2011, Russia embargo        | Oil up with day 2 to 20 drift. Gold flat. Equities flat.                          |
   | Producer policy   | Any OPEC or OPEC+ decision, any strategic reserve release; record consensus           | Nov 2014 no cut, Mar 2020 price war, Apr 2020 cut, Oct 2022 cut         | Oil instant, little drift; the move follows the surprise.                         |
   | Conflict onset    | First day of interstate war or a major state strike, with no supply lost that day     | Iraq 2003, Georgia 2008, Ukraine 2022, Gaza 2023                        | Gold up then reverts. Equities down day 0 to 1, recover. Oil anticipation window. |
   | Financial shock   | Failure or rescue of a systemically named institution, or a sovereign default scare   | Bear Stearns, Lehman, Greek crisis milestones, SVB 2023                 | Equities down with drift. Gold up. Oil down on demand with drift.                 |
   | Monetary surprise | A central bank decision off consensus, or an unscheduled one                          | Jan 2008 emergency cut, taper tantrum 2013, Mar 2020, Jackson Hole 2022 | Gold instant, inverse to the real-rate move. Equities instant. Oil flat.          |
   | Political shock   | An unexpected election or referendum result, or a government collapse, G7 economy     | Brexit 2016, US election 2016, Truss budget 2022                        | Equities instant, revert. Gold small up. Oil flat.                                |
   | Trade policy      | A tariff, embargo or sanctions package by a G7 government or China on a major partner | 2018 tariff rounds, Russia packages, April 2025 tariffs                 | Equities down day 0 to 1 with same-sign drift. Gold small up. Oil down on demand. |

   Logged but **not analysed** in the spike: pandemic milestones (2020 is one
   cluster), terror attacks (few, revert), natural disasters (the ones that
   matter to oil are supply shocks). They stay in the ledger for the tool.

6. **Headline hypothesis.** Oil supply shocks show a day 2 to 20 drift in the
   same direction as day 0 to 1, and no other category does in any series. If
   that fails, the slow-burn class is empty for these series, and any tool is
   a forecast journal only.

7. **What counts as a real pattern**, all of these, not one: category and
   horizon fixed beforehand; at least 15 events in the category; mean drift at
   least two standard errors from zero, sign agreeing in about three quarters
   of events; the sign survives dropping the largest event; the effect found
   in events before 2015 shows again in events after. The spike's ~7 per
   category is below the 15 bar; it tests the pipeline and gives a first look.
   The bar applies to the tool once the ledger has grown.

8. **If the spike earns a tool.** Then, and only then, `/add-tool` and a
   `00-ANALYSIS.md` carrying this ticket's method, the forecast-journal
   framing, and the spike's result. The tool shares nothing with the other
   three, which is the shape the repo wants. Rough scope: event ledger with
   categories, three series pulled nightly, a prediction form with a lockout,
   a scoring job, two charts. Not a trading tool, and it must not read as
   financial advice.

## Done when

- The decision above is answered on this ticket.
- If the spike runs: a report in this ticket's Log with one row per category
  and series for each of the three windows, the count and flags per category,
  and a verdict per registered expectation of held, failed or too few.
- A verdict on the headline hypothesis, and a recommendation on whether a tool
  follows.

## Log

**2026-10-26 — filed from a discussion with the owner.** The owner raised the
idea, chose to keep talking rather than spike, added trade policy as the
seventh category, then parked it. The data probes in Build 2 were run that day
from the devcontainer with the firewall open; the probe downloads were not
kept.
