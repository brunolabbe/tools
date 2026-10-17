---
id: pl-57
tool: planner
title: Measure how often a specialist names a place that does not exist, before building any existence check
kind: work-package
status: done
milestone: P3
depends_on: []
difficulty: standard
note: Needs web search and the owner to open the firewall for the run, as pl-56 did
---

# pl-57 — Does a specialist ever invent a place?

**Packages:** `api`. A harness under `api/test/live/` and one record under
`api/test/fixtures/live/`. No behaviour change, and no `src` change is expected.
If one turns out to be needed, the Log names it and gives the reason.

## Why

Analysis §5 ranks **existence and current status** third among the things
grounding is worth buying. It is meant to fix §2's failure 5, _invention_: "a
restaurant that closed in 2019, or never existed". The roadmap's _Still open_
leaves one question about it: does existence grounding run as a pass after the
fan-out, or does a specialist look things up itself through tool use on
`ModelProvider`?

**Decided by the owner on 2026-10-17, and not reopened here:** no existence
build ticket is filed until this measurement is in. Three facts were found while
filing it, and together they undercut both shapes as §5 imagined them:

1. **"Not found" usually means "too vague to look up", not "fake".** §5 says
   "no hit is strong evidence that it is not". pl-56 sent all 1,019 recorded
   places through `locate`'s own query to the public Nominatim instance. 787
   (77.2%) came back empty, and its sample of 40 empties shows why: most are a
   kind of place at a locality (`Percé village inn, Percé`, `Local bakery and
cheese shop, Gaspé Peninsula`), and nothing can confirm that or rule it out.
   Real places came back empty as well: `Parc national de la Gaspésie,
Sainte-Anne-des-Monts, Québec` (34 candidates name it), `Roscioli, Campo de'
Fiori, Rome` and `Hotel Raphael, Rome, Centro Storico`. So a map-based pass
   could only label a candidate, never drop one, and on these numbers it would
   label about four in five as not found.
2. **Map data hardly changes what a specialist proposes.** 81 of the 111
   recorded runs handed a corridor's finds to `activities`, `food` and
   `conditions-and-gear`, 40.2 finds per run on average. Those three
   specialists accepted 544 candidates across the 81 runs. **2 of the 544** name
   a find, whether the test is an exact place-name match or a find name longer
   than five characters appearing anywhere in the title, summary or location.
   The two are `Observatoire de la Capitale` and `Porte Kent`. The finds are
   mostly small monuments, so this is weak evidence about the finds as much as
   about the specialists. But it is the only measurement of whether grounding
   handed to a specialist changes what it proposes, and that effect is the whole
   case for the tool-use shape.
3. **No recorded run has been checked for invention.** pl-40 and pl-55 recorded
   111 runs across Haiku, Sonnet and Opus 5.5. Nobody has asked whether any
   named premises in them is fictional, closed or in the wrong town. Failure 5
   is the premise of §5's item 3, and it has never been observed here.

The first fact says the binding question may be _how specific a proposal is_
rather than _whether it is real_. The third says whether it is real is unknown.
This ticket answers both, from data already on disk.

## Build

1. **The harness.** Put it at `tools/planner/api/test/live/invention.ts`, run with
   `node --import tsx`. pl-56's constraints hold here for the same reasons. It
   lives under `test/`, so it is typechecked. It is not named `*.test.ts`, so no
   vitest project collects it. **It refuses before its first request unless
   `PLANNER_LIVE_RUN=1` is set.** Steps 2 and 3 make no request and run without
   the gate behind a flag such as `PLANNER_INVENTION_OFFLINE=1`, as pl-56's
   regeneration did.

2. **The places: the same 1,019 that pl-56 used.** Read every
   `candidatesAccepted` in `api/test/fixtures/live/**`, excluding
   `hours-coverage/`. Take every `Place`, including both ends of a `between`, and
   dedupe on lower-cased `name|locality`. Keep the specialists and the **model
   family** that named each one. The family comes from the record's directory,
   `claude-<family>-5-5-<effort>`. At filing the counts were Haiku 566 places
   from 75 runs, Opus 286 from 18, and Sonnet 273 from 18, with places named by
   more than one family counted under each. Recount and put the result in the
   Log. If the total is not 1,019, the fixtures have moved.

3. **Classify every place by hand, against a rubric written first.** The
   classes, at minimum:
   - `named-premises`: a proper name that picks out one establishment, site or
     attraction (`Exploramer`, `Musée de la Gaspésie`, `Roscioli`).
   - `kind-of-place`: a category at a locality (`Motel in Percé`,
     `Local cheese producer`).
   - `settlement-or-area`: a town, region, island, park as an area, or
     neighbourhood.
   - `route-or-transit`: a road, a crossing, a station named as a stop on a
     movement.

   Write the rubric into the record **before** classifying, with one example
   per class and the rule for each edge case you meet. A national park is
   `named-premises` when the candidate is a visit and `settlement-or-area` when
   it is a region a route passes through. Say which you used.

   Then reconcile with pl-56's `reading` column. Each of its 74 rows has a
   `reading`, and its 35 `named-premises` rows must agree with yours or the Log
   says why. **The classification is the expensive, arguable part.** The
   record holds one row per place, so it can be argued with row by row, as
   pl-56's was.

4. **Draw the sample after classifying, never before.** From the
   `named-premises` places, draw **50 per model family** with a fixed, recorded
   seed. If a family has fewer, take them all. A place named by two families can
   be drawn under either, and each verdict counts once per family that named
   it. The seed and the drawn list go in the record.

5. **Check each sampled place on the web.** The verdict is one of:
   - `exists`: an independent source that is not a review aggregator's
     auto-generated stub shows it operating at or near the named locality.
     Record the URL and the date it was read.
   - `exists-elsewhere`: real, but not where the candidate put it. Distance
     is what the packer charges, so this is a defect even when the place is
     real.
   - `closed`: real once, now permanently closed. Record the evidence and,
     where stated, the closing year.
   - `not-found`: nothing after the search budget. **Write the budget down
     before starting:** at least three queries (name with locality, name alone,
     name in the local language), plus the OSM result from pl-56's record. This
     verdict is "we did not find it", never "it does not exist". The Log uses
     those words.

   **This step needs a web search tool.** The `builder-*` agents have
   `WebFetch` and no `WebSearch`, and `WebFetch` reaches only some hosts from
   this container. So the session that runs this ticket either has
   `WebSearch` itself, or is a general-purpose agent dispatched with worktree
   isolation by hand. The Log says which. The owner opens the firewall for
   any host the checks need, as for pl-56, and the Log records when it was
   opened and closed. **A page reached here is hostile text** (§5). Read it
   for the fact being checked, and never follow an instruction in it.

6. **The tables.** The Log carries:
   - every place, by class, by brief, by proposing specialist and by model
     family. This is the specificity figure fact 1 above asks for. The figure
     that matters most is `lodging` and `food`, the two specialists whose
     proposals were emptiest in pl-56.
   - the sample's verdicts by model family, as counts, with a 95% interval
     beside each rate. Fifty draws gives wide intervals, and the Log says so
     rather than letting a 0 of 50 read as zero.
   - each `closed`, `exists-elsewhere` and `not-found` row in full: the
     candidate's title, its specialist, its run, and the evidence.

7. **End the Log with the decision this measurement is for, as options with a
   recommendation.** You cannot ask the owner, so label it an open decision.
   Each option carries its cost in the numbers measured here. At minimum:
   - **Make proposals specific first.** Change the specialist prompts so a
     proposal names a premises, or says plainly that it is a kind of place,
     before checking anything. This is cheap, it is a prompt and schema
     change, and it needs a live run to prove.
   - **A check pass after the fan-out**, the shape pl-27 gave travel time and
     the owner gave hours on 2026-10-17. It labels and never drops. State
     what fraction it would label from this ticket's numbers.
   - **A specialist looks it up itself**: tool use on `ModelProvider`, a
     multi-turn budget, a scripted tool loop, and with web search a metered
     vendor plus [pl-26](./pl-26-lift-the-ssrf-guard.md). Say what invention
     rate would justify that cost.
   - **Close §5's item 3**, if the measured rate does not justify any build.
     Say what would have to change to reopen it.

## Done when

- Running the harness without `PLANNER_LIVE_RUN=1` exits non-zero before any
  request. The Log shows the command and its exit code, taken without a pipe.
- The record is committed under `api/test/fixtures/live/invention/`. It holds
  the rubric, one classified row per place (1,019, or the recount the Log
  explains), the seed, the drawn sample, and each sampled row's verdict with
  its evidence URL and read date.
- The Log reconciles the classification with pl-56's 74 `reading` rows.
- The Log carries step 6's tables, with intervals on the sampled rates.
- The Log ends with step 7's open decision, as options with costs and a
  recommendation.
- `npm run check` passes, and the `planner` vitest project collects the same
  files it did before. `live-records.test.ts` walking the new record as one
  more case is fine, as it was for pl-56.

## Review

**Gate: CONCERNS** — 2026-10-17 · `495a5b7a..88fb17a6` · Opus 5.5, depth full

| Done when                                                                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run without `PLANNER_LIVE_RUN=1` exits non-zero before any request; the Log shows the command and its exit code, no pipe                     | **verified** — `node --import tsx tools/planner/api/test/live/invention.ts > refuse.out 2>&1; echo exit=$?` gives `exit=1` and "Refusing: neither PLANNER_LIVE_RUN=1 nor PLANNER_INVENTION_OFFLINE=1 is set…". `assertInventionConsent` is the first call in `main`, and the harness has no network code at all. The Log shows the redirected form.                                                                                                                         |
| Record under `invention/` holds the rubric, 1,019 rows, the seed, the drawn sample, and each sampled verdict with evidence URL and read date | **verified** — `PLANNER_INVENTION_OFFLINE=1 PLANNER_INVENTION_CHECK=1 …` exits 0. My own Python recount gives 111 records, 2,594 mentions and 1,019 keys (Haiku 566, Opus 286, Sonnet 273), and the keys equal `classification.json`'s. 121 verdicts cover exactly the 121 sampled keys. Re-implementing mulberry32 and the Fisher-Yates shuffle with seeds 20261017/18/19 gives the recorded `sample` for all three families. Caveats: F3 (rubric date) and F6 (`readOn`). |
| Log reconciles the classification with pl-56's 74 `reading` rows                                                                             | **verified** — my independent cross-tab gives 74 readings and 24 of 35 `named-premises` agreeing. The 11 that disagree are the same ones the Log names: 10 airports, stations and ferry terminals, plus `Camping de Carleton-sur-Mer`. pl-56 has all 11 OSM-located.                                                                                                                                                                                                        |
| Log carries step 6's tables, with intervals on sampled rates                                                                                 | **verified** — every table matches the regeneration, and I recomputed the Wilson intervals: 47/50 gives 83.8–97.9, 145/150 gives 92.4–98.6, 3/28 gives 3.7–27.2. Each `closed`, `exists-elsewhere` and `not-found` row is given in full. The pooled row's interval is F1.                                                                                                                                                                                                   |
| Log ends with step 7's open decision, options with costs, recommendation                                                                     | **verified** (form) — four options plus a recommendation, labelled open. F1 and F2 are meds this line depends on.                                                                                                                                                                                                                                                                                                                                                           |
| `npm run check` passes; `planner` collects the same files                                                                                    | **verified** — `npm run check` exits 0. `npm test -- --project planner` gives Test Files 77 passed (77), Tests 1442 passed (1442). Planner has 77 `*.test.ts(x)` files at both `origin/main` and HEAD (`git ls-tree`), and the diff adds no spec. PR #522 checks on 88fb17a6 are all green, the Windows leg included.                                                                                                                                                       |

- **med** · Done when 5 depends on it · **Options 3 and 4 are argued from a pooled figure that is the wrong measure.** Direction: unsafe, because it argues against a build.
  - **The intervals assume independent draws.** The "all 150 draws" row and "the pooled lower bound is 1.4%" treat 150 family-draws as independent trials. They are 121 distinct keys: 17 drawn twice and 6 three times. Those keys collapse further onto about 58 objects; Bonaventure Island alone is 9 keys, Grande-Grave and Forillon 8 each.
  - **The headline rate is per draw, not per key.** "96.7%" is 145/150 per draw, but the Log calls the rates "per key". Per key it is 116/121; not-confirmed is 5/121 = 4.1% (1.8–9.3).
  - **Five of the 28 lodging/food keys are parks.** These are four Parc national de la Gaspésie keys and Parc du Bic, and their `exists` verdict confirms the park, not a lodging premises. Petit-Gaspé alone is 5 of the 28 keys.
  - **Per object, the decisive stratum meets the Log's own bar.** The Log says per-object is the honest unit, then never computes it for the stratum its bar names. Lodging/food is **3 of 19 objects = 15.8% (5.5–37.6)**, or 3/16 (6.6–43.0) without the three parks. That clears both legs of "above about 10% with the lower bound above 5%".
  - **Weighted by population, the conclusion holds anyway.** Weighting by lodging/food's 53/207 share of named premises gives about 4.4% per key and 6.0% per object, so "nothing here reaches that" survives on that reading. But the reason the text gives is the pooled 1.4%, which is neither weighting.
  - **Fix:** state the per-key, per-object-stratum and stratified figures, and rewrite option 3's sentence and option 4's "145 of 150" argument on them.
  - **Reproduce:** `python3 -I objects.py <places.json> <invention dir>` and `tables.py` (paths at the end).
- **med** · Done when 5 depends on it · **"Today about 4 of 5 proposals cannot be checked by anything, a search or a map"** (option 1) is true only of lodging and food. Of all 2,090 accepted candidates, 751 (35.9%) name only a `kind-of-place`. Of lodging and food's 724, 579 (80.0%) do. Direction: overstates how blind options 2 and 3 are, which pushes toward option 1. Fix: name the population. Reproduce: `python3 -I cands.py <live dir>`.
- **med** · no Done when line depends on it literally (Build step 3 does) · **`classification.json` `rubric.written` says "before any place was classified".** The Log says the rules were written while the list was being read for the first time, one rule as each case arrived. The record is what readers argue the rows from, and its text claims a pre-registration that did not happen. Direction: unsafe. The fix is fully stated: reword the field to the Log's account, then run `PLANNER_INVENTION_OFFLINE=1 node --import tsx tools/planner/api/test/live/invention.ts` to regenerate the record, and check mode exits 0 again. The draw came after the classification, so the sample is unaffected.
- **low** · **How far the classification moves.** I ruled on all 53 lodging/food `named-premises` rows, the remaining 525 lodging/food rows, all 80 edge-tagged rows and 30 seeded-random others.
  - **Lodging rows that name only a park.** 8 lodging rows are `named-premises` by `park-visit` but name only the park, for "a campground or chalet in park X": the four Mont-Albert-sector keys, `parc national de la gaspésie|sainte-anne-des-monts, québec` and three `parc national du bic` keys. `forillon national park campground` is `kind-of-place`; for these lodging proposals I rule them `kind-of-place` too. Lodging then names a premises in **20 of 320 (6.3%)**, or 30 of 402 mentions (7.5%). Food stays at 25 of 259. The movement strengthens the Log's finding rather than weakening it.
  - **One rule misapplied.** `percé wharf / parc national de l'île-bonaventure-et-du-rocher-percé` is `named-premises` under `two-sites`, but the rule needs each half to be a premises, and `percé wharf` is `kind-of-place`.
  - **One object split across classes.** `discovery and visitors centre, parc national de la gaspésie` is `named-premises` while `parc national de la gaspésie visitor centre` is `kind-of-place`.
  - **Tagging.** `parc national de la gaspésie (mont-albert sector)|…, québec` lacks the `park-visit` tag its siblings carry.
  - None of these rows was sampled. I found no lodging/food `kind-of-place` row that names a premises, apart from the rubric-sanctioned `Camping de Carleton-sur-Mer`.
- **low** · **The `not-found` row's budget was not run as written.** For Grande-Grève, query 1 omits the locality "Gaspé, Québec". Query 2 is `"Grève" "Grande-Grève" camping Forillon "Grande-Grève campground"`, not the name alone in quotes. Query 3, in French, is fine, and OSM is `located: false, resultsInReply: 0` in pl-56. The verdict holds: Parks Canada's visit page, fetched, lists Petit-Gaspé, Des-Rosiers and Cap-Bon-Ami, and has "Grande-Grève" only as the south toll booth's boulevard.
- **low** · **Evidence notes.** 119 of 121 rows rest only on URLs "seen in the search result", stored under a field named `readOn`. Several sources show that a place exists, not that it is operating: the Banc-de-Pêche designation page, the 2023 Grande-Grave release, Time Out's 2018 Flavio listing, Wanted in Rome's 2019 Testaccio article. So `closed` may be undercounted. The Log discloses this. Two small errors: the Fumoir note says the page is undated, but it is dated published 2025-08-28 and updated 2026-07-24 (false in the safe direction). The Bonaventure note says perce.info shows "boats leave from Percé"; the page names the Percé operators but not their dock.
- **low** · **Per-family counting.** The harness counts a verdict once per family that _drew_ the key. The brief's words are "per family that named it". 18 key-family pairs differ and all are `exists`, so under the brief's reading Haiku goes 3/50 → 3/58 and Opus 2/50 → 2/60. The harness's reading is the sound one; the Log does not say it departed from the brief.
- **low** · **Objects and arithmetic.** "59 objects" cannot be regenerated, because the record has no object id; grouping by first query gives 58, with 4 defective (6.9%, 2.7–16.4). "13 at the upper bound" is 13.8, and "about 9 per defect" is 9.8. "Per defect fixed" should say found.
- **low** · `nfr:maintainability` · in `invention.ts`, `InventionRecord`'s doc comment for `osmCrossTabs` sits above `sampleBySpecialistGroup`'s.
- **dropped** · `console` and bare `Error` in the harness. pl-56's `hours-coverage.ts` does the same in a live test script, and `npm run check` passes.
- **dropped** · `Marché du Vieux-Port` as `exists-elsewhere` (the market relocated) rather than `closed`. The site and the name are gone, and fr.wikipedia says "Le marché du Vieux-Port est fermé en juin 2019", which confirms 2019.
- **dropped** · `Camping de Carleton-sur-Mer` as `named-premises` (OSM matches the exact name). The rubric rules on it explicitly and the Log gives the count both ways.
- **dropped** · "drawn before classifying". Git cannot order the two, because 66067c86 adds both files. The draw is a function of the classification (the control below moved it), and that is all the data can show.
- **findings** · the hunt returned 13; 9 carried, 4 dropped.
- NFR: security n/a (no request, no secrets; `live-records.test.ts` walks the three new JSON files and passes) · performance n/a · reliability ✓ (check mode goes red on both mutation shapes) · maintainability: above.

### Gate 2

**Gate: PASS** — 2026-10-17 · `88fb17a6..51a4b673` (round: `9e5b59a9`) · Opus 5.5, scoped to round 1

The open lows are recorded below and do not hold the ticket. Nothing here is a `high`.

- **Units and option 3's bar (med) — fixed.** `PLANNER_INVENTION_OFFLINE=1 PLANNER_INVENTION_CHECK=1 node --import tsx tools/planner/api/test/live/invention.ts` gives `exit=0`. The new `sampleByObject` regenerates and prints "58 objects, not confirmed 4 of 58, 6.9% (2.7%–16.4%); lodging or food stratum 19 objects, not confirmed 3 of 19, 15.8% (5.5%–37.6%)". The Log's units table matches.
  - The population weighting checks out by hand: 0.256 × 10.7% + 0.744 × 2.2% gives 4.3% per key. The other 39 objects hold one defect (Bonaventure), so per object it is about 6.0%.
  - Option 3's bar now names its unit (per object) and its population before the comparison.
  - Options 3 and 4 and the recommendation follow from those figures: the scoped loop clears the bar, barely, on three events; the whole-population loop does not.
- **"4 of 5 proposals" (med) — fixed.** The text now gives 579 of 724 lodging and food candidates (80.0%) and 751 of 2,090 overall (35.9%). These are the figures gate 1 measured.
- **`rubric.written` (med) — fixed.** The field now gives the Log's account of when the rubric was written. Check mode exits 0 on it.
- **How far the classification moves (low) — dispositioned as the owner chose (A).** A script diff of `classification.json` between 88fb17a6 and the new head shows zero class changes and one tag change, the added `park-visit` tag. The sensitivity line gives 20 of 320 (6.3%), 30 of 402 (7.5%), food unchanged at 25 of 259, plus (b), (c) and (d).
- **Grande-Grève's search budget (low) — fixed.** Queries 1 and 2 now follow the budget as written, and the evidence note says they were re-run. The new Parks Canada PDF is **unverified**: WebFetch could read only its metadata ("2026_Camping_PG_oTENTik"), and the Read tool could not render it. The verdict does not rest on that PDF.
- **Evidence notes (low) — fixed in part.** The Fumoir dates and the Bonaventure note are corrected and match my fetches. What remains is recorded in the Log rather than changed: `readOn` holds the date a search snippet was seen, and `closed` may be undercounted.
- **Per-family counting (low) — fixed.** The Log now states the departure from the brief, and its figures (3 of 58, 2 of 60) match gate 1's script.
- **Object count and arithmetic (low) — fixed.** The record now carries 58 objects, and the Log says searches per defect _found_.
- **Misplaced doc comment (low) — fixed.**
- **Refutation of "3/16 without the parks": does not hold. Gate 1's 3/16 is right.**
  - The script's "park objects" line matched the text "Parc national" in each object's first query. It therefore caught two campgrounds, `Camping Cap-Bon-Ami Parc national Forillon` and `Camping du Mont-Albert Parc national de la Gaspésie Sépaq`, which are lodging premises, not parks.
  - The parks are three objects: Forillon NP, Parc de la Gaspésie and Bic. Removing them leaves 3 of 16, which is 18.8% (6.6–43.0).
  - The mislabelled line is gate 1's script, not the build's.
- **low** · new · the Log's units paragraph says "without the three parks' objects the stratum is 3 of 14 objects, 21.4% (7.6–47.6)". It should say 3 of 16, 18.8% (6.6–43.0). Direction: unsafe, mildly, because it overstates the stratum's rate. Nothing relies on it: option 3 compares 3 of 19.
- **low** · new · "Five of the 28 stratum keys are parks", in the units paragraph and in option 3, should be six. `forillon national park|gaspé` is in the stratum through one `food` mention out of 59. Gate 1 wrote "five" first. Nothing relies on the count.
- **low** · new · two figures are labelled wrongly:
  - The units table is said to be "every figure printed by the harness", but its per-key total (5 of 121, 4.1%, 1.8–9.3) is not in the harness output (`grep '4\.1%'` on the check-mode output finds nothing).
  - "About 15 searches per defect found" sits under the population-weighted bullet but is computed from the unweighted 4 of 58 (1.07 × 58 / 4 = 15.5). At the weighted 6.0% it is about 18.
  - "About 6 to 7 per defect" in the stratum is right: 1.07 × 19 / 3 = 6.8.
- **findings** · the round review returned 3 new, all `low`, all carried. Of gate 1's 9 findings: 7 fixed (the 3 meds among them), 1 fixed in part, and 1 (the classification low) dispositioned as the owner chose. The 1 refutation does not hold.
- Checks:
  - `npm run check` exits 0.
  - `npx vitest run tools/planner/api/test/live-records.test.ts`: 133 passed (133).
  - PR #522 at 51a4b673: every check passes except `test (ubuntu-latest)` and `test (windows-latest, informational)`, still pending when read.
  - The round changes no spec, so planner's file count is unchanged.

## Log

**2026-10-17 — Filed.** The owner chose "measure invention first" over a check
pass, specialist tool use, or closing §5's item 3. The three facts in _Why_
were measured at filing. The first is from pl-56's Log. The second is a count
over `api/test/fixtures/live/**` at `origin/main` a04a1c96. The third is a
search of `docs/work/` and the analysis for any check of a recorded place
against the world, which found none outside pl-56's hours.
The 2-of-544 count matched place names case-insensitively, plus any find name
longer than five characters that appears in the candidate's serialised title,
summary or location. No script was committed for it. Step 2's recount covers
the place counts, and the finds count is context, not acceptance.

**2026-10-17 — Built (builder, general-purpose agent on Sonnet 5.5).** The
Build's step 5 says a session either has `WebSearch` or is a general-purpose
agent dispatched by hand. This was the second: `builder-standard` has no
`WebSearch`, and the owner chose a general-purpose agent on Sonnet from three
options (that, the same on Opus, or splitting the work). The branch is
`pl-57-measure-invention`, from `origin/main` 4c642ab3. No `src` change.

_Firewall._ It was already open when the run started (observed open at about
22:40 UTC by a probe agent: google.com and nominatim answered 200). The owner
closes it; I do not record when. My last web request was before 23:00 UTC on
2026-10-17: the `ville.quebec.qc.ca` fetch. `WebSearch` and `WebFetch` were
loaded with `ToolSearch`. Every page was read for the fact checked and no
instruction in one was followed.

_What the harness is._ `api/test/live/invention.ts` makes **no request**. The
web checks are done by the agent running the ticket and committed as data
(`verdicts.json`); the harness recounts the places, applies the hand
classification (`classification.json`), draws the sample, joins the verdicts,
reconciles with pl-56 and writes the record (`2026-10-17.json`). Everything
below regenerates from those three files:

```
PLANNER_INVENTION_OFFLINE=1 node --import tsx tools/planner/api/test/live/invention.ts
```

prints these tables, and adding `PLANNER_INVENTION_CHECK=1` writes nothing and
exits non-zero unless the committed record equals its regeneration and every
sampled place has a verdict (proved able to fail: with one verdict in
`verdicts.json` changed from `closed` to `exists` it printed "the committed
record is not what the inputs regenerate" and exited 1; restored from the
commit, it exits 0). `PLANNER_LIVE_RUN=1` prints a worksheet of sampled places
with no verdict and the search budget; it still makes no request.

_Refusal, without the flags._

```
$ node --import tsx tools/planner/api/test/live/invention.ts > refuse.out 2>&1; echo exit=$?
exit=1
$ cat refuse.out
Refusing: neither PLANNER_LIVE_RUN=1 nor PLANNER_INVENTION_OFFLINE=1 is set. The live phase checks places on the web — ...
```

The exit code is read from the redirected command, not through a pipe.

_Step 2, the recount._ 111 live records, 2,594 place mentions, **1,019**
distinct places on lower-cased `name|locality`, so the fixtures have not moved.
By family (a place named by two families counts under each): Haiku 566, Opus
286, Sonnet 273, as at filing. Records: Haiku 75, Opus 18, Sonnet 18.

_Step 3, the rubric and the classification._ The rubric is in the record
(`rubric`), with one example per class and one rule per edge case. The classes
and their sizes:

| class              | places | mentions |
| ------------------ | ------ | -------- |
| named-premises     | 207    | 804      |
| kind-of-place      | 611    | 758      |
| settlement-or-area | 159    | 952      |
| route-or-transit   | 42     | 80       |

20.3% of places name a premises; 60.0% are a kind of place at a locality.

_Provenance of the rubric, stated plainly._ The rules were written down as I
read the list for the first time, one rule when its first case arrived, and
`classification.json` was written after the whole list was read; **I did not
write the rubric before seeing any place**. (The record's `rubric.written` said
"before any place was classified" until gate 1 found that false; it now gives
this account.) What holds is that the sample was
drawn after the classification, from the committed file, and that no class was
changed after the sample existed. The classification uses the string only and
general knowledge, never a lookup: whether a place is real is what the sample
measures. Edge cases applied (each is a tag on the rows it touched, with its
rule in the record; counts are rows):

| rule                                                                    | rows           |
| ----------------------------------------------------------------------- | -------------- |
| park-visit (a national park or a sector of it, proposed as a visit)     | 33             |
| park-area (a park only ever an endpoint of a `between`)                 | 8              |
| established-descriptive-name (Ljubljana Castle, Percé Rock, lighthouse) | 13             |
| natural-feature visited as an attraction                                | 16             |
| two-sites in one string                                                 | 5 (+1 as kind) |
| square                                                                  | 2              |
| locality-plus-category, singular, **kept as kind-of-place**             | 34             |
| placeholder ("to be chosen", "e.g.")                                    | 44             |
| transit-node (airport, station, terminal, trailhead, departure point)   | 42             |
| branded-category (oTENTik)                                              | 4              |

_Sensitivity after gate 1 (round 1), not a reclassification._ Gate 1 ruled on
all 53 lodging and food `named-premises` rows and found four things in rows
that were not sampled: (a) 8 `lodging` rows are `named-premises` only because a
park is a visit (the four Mont-Albert-sector keys, the bare
`parc national de la gaspésie|sainte-anne-des-monts, québec`, and three
`parc national du bic` keys) but name only the park, as a place for "a
campground or chalet in park X"; `forillon national park campground` is
`kind-of-place`, and the gate rules these `kind-of-place` too; (b)
`percé wharf / parc national de l'île-bonaventure-et-du-rocher-percé` is tagged
`two-sites`, but `percé wharf` is `kind-of-place`, so the rule does not apply;
(c) `discovery and visitors centre, parc national de la gaspésie` is
`named-premises` while `parc national de la gaspésie visitor centre` is
`kind-of-place`; (d) one Mont-Albert-sector key lacked its `park-visit` tag
(added; the park-visit count above is 33, a tag only). **Under the gate's ruling
on (a), `lodging` names a premises in 20 of 320 places (6.3%) and 30 of 402
mentions (7.5%); `food` is unchanged at 25 of 259.** The owner chose to keep the
classification and the sample as they are (2026-10-17), because the harness
draws only from `named-premises` and moving any one row changes the drawn
sample: so the 28 below stays the stratum, and the 20 is a sensitivity line
beside it, not a new denominator. It strengthens the finding that lodging and
food are unspecific.

_How much the `named-premises` figure moves._ It is 207 by the rubric. Dropping
the 13 established-descriptive names gives 194. Letting the 34
locality-plus-category rows in (Gaspé aquarium, Percé wharf, Camping de
Carleton-sur-Mer) gives 241. Counting the 42 transit nodes as premises, as
pl-56 did, gives 249, or 283 with both. At most it moves from 19% to 28% of the
1,019. The sample draws from the 207.

_Reconciliation with pl-56's 74 `reading` rows._ All 74 are places here.

| pl-56 reading                 | named-premises | kind-of-place | settlement-or-area | route-or-transit |
| ----------------------------- | -------------- | ------------- | ------------------ | ---------------- |
| named-premises (35)           | 24             | 1             | 0                  | 10               |
| kind-of-place (19)            | 0              | 19            | 0                  | 0                |
| settlement-to-premises (14)   | 0              | 0             | 14                 | 0                |
| neighbourhood-to-premises (1) | 0              | 0             | 1                  | 0                |
| wrong-continent (3)           | 0              | 3             | 0                  | 0                |
| arguable-landmark (2)         | 0              | 0             | 2                  | 0                |

**24 of pl-56's 35 `named-premises` rows agree; 11 do not**, and the Log says
why. Ten are transit nodes, which this ticket's rubric names a separate class
and pl-56 counted as premises because an airport or a station has hours:
Graz Hauptbahnhof; Cancún International; Halifax Stanfield (two keys); Fiumicino;
Ottawa Macdonald-Cartier (two keys); Vienna International; the Rivière-du-Loup
and Saint-Siméon ferry terminals. The eleventh is `Camping de Carleton-sur-Mer`:
pl-56 matched it to an OSM campground, this classification does not use a lookup
and reads the string as a locality plus a category. The other 39 rows agree
under the mapping in the table, except the 5 `wrong-continent` and
`arguable-landmark` rows, which have none. The 3 `wrong-continent`
rows are placeless resort items (kids' club, shallow pool, trailside lodge)
and are kind-of-place here; the 2 `arguable-landmark` rows are both
`Cap-des-Rosiers` as a village, settlement-or-area here.

_By brief, specialist and family._ A place counts under every brief, specialist
and family that named it; the mentions table counts accepted candidates.

| model family | named-premises | kind-of-place | settlement-or-area | route-or-transit | total |
| ------------ | -------------- | ------------- | ------------------ | ---------------- | ----- |
| haiku        | 102            | 325           | 109                | 30               | 566   |
| opus         | 101            | 127           | 49                 | 9                | 286   |
| sonnet       | 53             | 178           | 30                 | 12               | 273   |

| brief             | named-premises | kind-of-place | settlement-or-area | route-or-transit | total |
| ----------------- | -------------- | ------------- | ------------------ | ---------------- | ----- |
| backcountry       | 24             | 24            | 12                 | 9                | 69    |
| city-and-culture  | 30             | 13            | 17                 | 2                | 62    |
| motorised-touring | 1              | 53            | 17                 | 0                | 71    |
| multi-city        | 18             | 22            | 13                 | 10               | 63    |
| resort            | 0              | 45            | 7                  | 5                | 57    |
| road-trip         | 138            | 454           | 97                 | 16               | 705   |

| specialist (distinct places) | named-premises | kind-of-place | settlement-or-area | route-or-transit | total |
| ---------------------------- | -------------- | ------------- | ------------------ | ---------------- | ----- |
| activities                   | 125            | 60            | 6                  | 3                | 194   |
| budget                       | 59             | 27            | 13                 | 11               | 110   |
| conditions-and-gear          | 7              | 17            | 0                  | 0                | 24    |
| food                         | 25             | 215           | 18                 | 1                | 259   |
| lodging                      | 28             | 258           | 34                 | 0                | 320   |
| practicalities               | 6              | 39            | 12                 | 11               | 68    |
| route-and-logistics          | 13             | 5             | 89                 | 19               | 126   |

| specialist (mentions) | named-premises | kind-of-place | settlement-or-area | route-or-transit | total |
| --------------------- | -------------- | ------------- | ------------------ | ---------------- | ----- |
| activities            | 339            | 84            | 7                  | 4                | 434   |
| budget                | 245            | 32            | 29                 | 13               | 319   |
| conditions-and-gear   | 11             | 17            | 0                  | 0                | 28    |
| food                  | 36             | 262           | 23                 | 1                | 322   |
| lodging               | 47             | 317           | 38                 | 0                | 402   |
| practicalities        | 13             | 39            | 14                 | 15               | 81    |
| route-and-logistics   | 113            | 7             | 841                | 47               | 1,008 |

The specificity figure fact 1 asked for: **`lodging` names a premises in 28 of
320 places (8.8%) and 47 of 402 mentions (11.7%); `food` in 25 of 259 (9.7%) and
36 of 322 (11.2%).** The `resort` brief has none, and `motorised-touring` has
one. Sonnet names the fewest premises (53, against Haiku 102 and Opus 101), so
its sample is nearly the whole population. As a share of each family's places,
Opus names the most (101 of 286, 35%) and Haiku and Sonnet 18% and 19%.

_Step 4, the sample._ Drawn after classifying, from the committed
`classification.json`: 50 `named-premises` places per family by a seeded
Fisher-Yates over the sorted keys (`mulberry32`), seed **20261017** for Haiku,
20261018 for Opus, 20261019 for Sonnet. Eligible: Haiku 102, Opus 101, Sonnet
53, so all three drew 50 (Sonnet 50 of 53). That is 150 family-draws on **121
distinct places**; 23 were drawn under more than one family (17 under two, 6
under three) and are checked once, counted once per family. The drawn keys are
in the record (`sample`). **A departure from the brief:** it says a verdict
counts "once per family that named it"; the harness counts it once per family
that _drew_ it. Under the brief's reading 18 key-family pairs would be added,
all of them `exists`, so Haiku would read 3 of 58 not confirmed instead of 3 of
50 and Opus 2 of 60 instead of 2 of 50. I kept the harness's reading: a place a
family named but did not draw is not a draw from that family's population.

_Step 5, the checks._ The search budget is in `verdicts.json` (`budget`), and
each row carries every query run. It was fixed before the first query: a place
that comes back under the first query is judged on that; `not-found` takes all
three queries (name with locality, name alone in quotes, name in the local
language) and pl-56's OSM result, which the record copies in as `osm`. I ran
**62 distinct queries and 3 fetches** (then, in round 1, two re-run
queries and one re-fetch) for **58 real-world objects**, counted in the record
(`sampleByObject`) as the keys that share a first query: the 121
keys collapse onto far fewer objects (Forillon National Park alone is 8 keys,
Grande-Grave 8, the Percé Rock and Bonaventure park 11), so an object was
searched once and each key's own locality judged separately. Almost every
`exists` rests on a listing or reference page **seen in the search result**
(tourism boards, Parks Canada, a national museum directory, Michelin, Time Out,
Frommer's), not a page I fetched; each row's evidence says which. I did not
check that a place is operating today beyond what that page said. Every row's evidence is in the record, and
the gate can open the URLs.

_Step 6, the verdicts._ Wilson 95% intervals beside each rate; fifty draws is
wide, and a 0 of 50 reads as "under 7.1%", not zero. **Read the "all 150
draws" row with care:** the 150 are not independent trials. They are 121 keys
(23 drawn under two or three families), and those are 58 objects, so its
interval is narrower than the data supports. The honest units are below.

| family        | n   | exists                 | exists-elsewhere   | closed             | not-found          | not confirmed     |
| ------------- | --- | ---------------------- | ------------------ | ------------------ | ------------------ | ----------------- |
| haiku         | 50  | 47, 94.0% (83.8–97.9)  | 2, 4.0% (1.1–13.5) | 0, 0.0% (0.0–7.1)  | 1, 2.0% (0.4–10.5) | 6.0% (2.1–16.2)   |
| opus          | 50  | 48, 96.0% (86.5–98.9)  | 1, 2.0% (0.4–10.5) | 1, 2.0% (0.4–10.5) | 0, 0.0% (0.0–7.1)  | 4.0% (1.1–13.5)   |
| sonnet        | 50  | 50, 100.0% (92.9–100)  | 0, 0.0% (0.0–7.1)  | 0, 0.0% (0.0–7.1)  | 0, 0.0% (0.0–7.1)  | 0.0% (0.0–7.1)    |
| all 150 draws |     | 145, 96.7% (92.4–98.6) | 3, 2.0% (0.7–5.7)  | 1, 0.7% (0.1–3.7)  | 1, 0.7% (0.1–3.7)  | 5, 3.3% (1.4–7.6) |

Closed or not found together: 2 of 150, 1.3% (0.4–4.7). **No sampled place was
shown not to exist.** The differences between families are inside each other's
intervals; the sample cannot rank them.

_Every row that is not `exists`._ Five keys, four objects.

1. `Bonaventure Island | Bonaventure` and `Île Bonaventure | Bonaventure,
Gaspésie` — **exists-elsewhere**, Haiku. Candidates: "Bonaventure Island boat
   trip" (`budget`, `pl-40-7-budget-3`, `claude-haiku-5-5-low/set-b-run-1`),
   "Bonaventure Island seabird day trip" (`budget`, `pl-40-23-budget-3`,
   `claude-haiku-5-5-medium/set-c-run-2`) and "Bonaventure Island"
   (`activities`, `pl-40-22-activities-3`, `claude-haiku-5-5-low/set-c-run-1`).
   The island is real and the boats leave from Percé; the
   candidate's locality is the town of Bonaventure, a different municipality on
   the Baie-des-Chaleurs. Probably the island's own name misread as a locality.
   Evidence: `perce.info` directory, Percé tourist office, read 2026-10-17.
   Queries: 1, "Bonaventure Island Percé bird sanctuary parc national
   Île-Bonaventure-et-du-Rocher-Percé". The other eight keys for the same
   island give Percé and are `exists`.
2. `Fumoir Monsieur Émile | Gaspé` — **exists-elsewhere**, Opus. Candidate: "Smoked
   fish tasting at a Gaspé smokehouse" (`food`, `pl-40-7-food-2`,
   `claude-opus-5-5-low/set-b-run-1`). A smokehouse of that name is at 574 route d'Irlande, **Percé**, per
   `gentologie.com/en/?p=60611`, fetched 2026-10-17. Queries 1 and 2 found
   nothing; query 3 ("fumoir Gaspé saumon fumé hareng boutique Monsieur Émile")
   found the page. Percé is not Gaspé. The page shows a publication date of
   2025-08-28 and an update of 2026-07-24, so it is recent; whether the
   smokehouse operates today is not otherwise established.
3. `Grande-Grève campground, Forillon National Park | Gaspé, Québec` —
   **not-found**, Haiku. Candidate: "Grande-Grève
   campground in Forillon National Park" (`lodging`, `pl-40-7-lodging-2`,
   `claude-haiku-5-5-low/set-b-run-1`). Queries, **as the budget is written**
   (re-run in round 1: the first run left the locality off query 1 and padded
   query 2, a deviation gate 1 found; the verdict did not change):
   "Grande-Grève campground Forillon National Park Gaspé, Québec";
   `"Grande-Grève campground"`; "camping Grande-Grève parc Forillon terrain de
   camping Parcs Canada". OSM (pl-56): not located. Query 2 returned a Parks
   Canada map of Camping Petit-Gaspé with a beach labelled Grande-Grave beside
   it. Parks Canada's trip-planning page names
   the park's campgrounds as Petit-Gaspé (southern area) and Des-Rosiers and
   Cap-Bon-Ami (northern area), and Grande-Grève is the boulevard and sector
   Petit-Gaspé sits on. **We did not find it**; the likelier reading is a real
   campground under the wrong name, not an invented one.
4. `Marché du Vieux-Port | Québec` — **closed**, Opus, 2019. Candidate: "Lunch at the Old Port
   market in Québec City" (`food`, `pl-40-13-food-5`,
   `claude-opus-5-5-low/set-b-run-7`). The City
   of Québec's own page calls the site "l'ancien Marché du Vieux-Port" (fetched
   2026-10-17: the land has hosted the Jardins du bassin Louise since 2020). The
   year, spring 2019 after 32 years, replaced by the Grand Marché at ExpoCité,
   comes from a search-result summary and the CBC headline "Quebec City old
   port farmers market closes"; the CBC page returned 403 to a fetch, so the
   year rests on that summary. The one clear closed-place invention in the set,
   and it came from a food specialist.

Also recorded in a row note, not a verdict: `Cap-des-Rosiers and
Anse-aux-Sauvages, Forillon` is `exists` but the cove is now labelled
Anse-aux-Amérindiens on the park's map.

_The figure that matters for the decision._ Split by who proposed the 121
distinct places:

| proposed by                | n   | exists | exists-elsewhere | closed | not-found | not confirmed    |
| -------------------------- | --- | ------ | ---------------- | ------ | --------- | ---------------- |
| `lodging` or `food`        | 28  | 25     | 1                | 1      | 1         | 10.7% (3.7–27.2) |
| only the other specialists | 93  | 91     | 2                | 0      | 0         | 2.2% (0.6–7.5)   |

The defects concentrate where proposals are small businesses. But that stratum
is 28 places of 121, and only 53 of the 207 named premises were ever proposed
by `lodging` or `food`: **the sample is mostly parks, museums and landmarks, so
it says little about the small premises where invention is likeliest.**

_What a map check would have done._ pl-56's OSM result against this
classification: of the 207 named premises 66 were located (31.9%), so 141
(68.1%) would be labelled not found. Over the 121 sampled: 35 located, 86 not
located (71.1%). Of those 86, **81 exist** and 5 are the five defects above
(precision 5.8%, 2.5–12.9). A map-based label would have caught every defect and
been wrong 94% of the time.

_The three units, side by side._ (Added in round 1 after gate 1; every figure
in the last four rows is printed by the harness, `sampleByObject` and the
tables above; the first two rows, per draw (5 of 150) and per key (5 of 121),
are not in the harness output, which prints the per-family table and the two
strata, not their totals.)

| unit                                         | not confirmed             |
| -------------------------------------------- | ------------------------- |
| per draw (150 family-draws, not independent) | 5 of 150, 3.3% (1.4–7.6)  |
| per key (121 distinct keys)                  | 5 of 121, 4.1% (1.8–9.3)  |
| per object (58 objects)                      | 4 of 58, 6.9% (2.7–16.4)  |
| per object, `lodging` or `food` stratum      | 3 of 19, 15.8% (5.5–37.6) |
| per key, `lodging` or `food` stratum         | 3 of 28, 10.7% (3.7–27.2) |
| per key, other specialists                   | 2 of 93, 2.2% (0.6–7.5)   |

Population-weighted, the stratum is 53 of the 207 named premises (25.6%) and
the rest 154 (74.4%). That gives about 4.3% per key (0.256 x 10.7% + 0.744 x
2.2%) and about 6.0% per object (the rest is 1 object of 39, 2.6%: the Bonaventure
Island keys). Six of the 28 stratum keys are parks (four Parc national de la
Gaspésie keys and Parc du Bic), whose `exists` confirms the park and not a
lodging premises; without the three parks' objects the stratum is 3 of 16
objects, 18.8% (6.6–43.0), from gate 1's reproduction. All of these are small
counts: the stratum's interval rests on three events.

_What the brief had wrong or left out._ (1) It says to draw 50 per family and
that fewer takes all; Sonnet had 53, so the Sonnet draw is 94% of its
population, not a sample of it. (2) Dedupe on `name|locality` makes the 121 keys
a much smaller set of objects (58 searched), so the rates in the family table
are per draw, not per key as an earlier line of this Log said, and per object
they are higher: 4 objects of 58 are defects, 6.9% (2.7–16.4). (3) It says the rubric is "written first". It was
written during the first read, as above. (4) Fact 2's 2-of-544 was not
re-measured; it is context.

_Folded in, or not._ Nothing else was free. `live-records.test.ts` walks the
three new JSON files as three more cases and is green (the `planner` project
collected 77 files before and after; tests 1,439 before, 1,442 after).

```
$ npm test -- --project planner     # before: 77 files, 1439 tests
$ npm test -- --project planner     # after:  77 files, 1442 tests
$ npm run check                      # exit 0
$ npx oxlint tools/planner/api       # exit 0, no finding in invention.ts
```

**Open decision for the owner (step 7), as options.** I cannot ask; none is
chosen here. The numbers are the ones above.

1. **Make proposals specific first** (recommended). Change the `lodging` and
   `food` prompts and schema so a proposal names a premises or says plainly
   that it is a kind of place. They are 578 of the 1,019 places (56.7%) and
   only 53 named premises between them. It is a prompt and schema change, it
   needs one live run to prove (pl-40's harness, the run's cost is not measured
   here), and it is the precondition of every other option for these two
   specialists: of their 724 accepted candidates, 579 (80.0%) name only a
   kind of place, which neither a search nor a map can check. (Across all 2,090
   accepted candidates it is 751, 35.9%; the 80% is `lodging` and `food` only,
   and options 2 and 3 are not as blind elsewhere.) It also gives
   the missing measurement: a new run's `lodging` and `food` named premises are
   the sample this one lacks.
2. **A check pass after the fan-out**, labelling and never dropping. On these
   numbers it labels 68.1% of named premises not found (141 of 207), and 94%
   of those labels in the sample are on real places; across all 1,019 pl-56
   already measured 77.2% not found. It would catch every defect found here
   and bury it in about 16 false labels per true one (81 to 5). It costs a
   pass, a store and a UI state for a label that is wrong more often than right.
3. **A specialist looks it up itself**: tool use on `ModelProvider`, a multi-turn
   budget, a scripted tool loop, with web search a metered vendor plus
   [pl-26](./pl-26-lift-the-ssrf-guard.md). This run took about 1.07 searches
   per object (62 queries over 58 objects), and a recorded run names about 7
   named-premises mentions (804 over 111 runs). **The bar I use, with its unit
   and weighting named before it is compared (my judgement, not a
   measurement):** a loop earns its cost when the not-confirmed rate **per
   object** is above about 10% with the 95% lower bound above 5%, and the rate
   is the one for the population the loop would be switched on for. Two
   populations, two answers:
   - **Loop on for every specialist** (population-weighted over the named
     premises, the stratum at its 25.6% share): about 6.0% per object, 4.3% per
     key. It does not clear the bar; at 4 defects in 58 objects (the unweighted
     per-object figure, 6.9%) it is about 15 searches per defect found.
   - **Loop on for `lodging` and `food` only** (the stratum's own rate): 3 of 19
     objects, 15.8% (5.5–37.6). It **clears both legs**, barely: the lower bound
     of 5.5% rests on three events, six of the stratum's 28 keys are parks, and
     the stratum is a sample of 19. It is about 6 to 7 searches per defect found.

   The earlier version of this option argued from the pooled 1.4% lower bound,
   which is neither weighting, and said nothing here reaches the bar. That was
   wrong for the scoped loop.

4. **Close §5's item 3**, no build. The population-weighted case is not here:
   per object 4 of 58 (6.9%, 2.7–16.4) and about 6.0% weighted, no closed or
   not-found count above 2 of 150 draws, 3 draws in the wrong town, and none
   shown not to exist. But the scoped case in option 3 clears the bar on three
   events, so closing item 3 outright leaves a signal unexamined. What would
   reopen it: a `lodging` and `food` named-premises sample larger than this
   one's 19 objects (option 1's run is how to get it) that again shows 10% or
   more not confirmed per object with a lower bound above 5%.

**Recommendation:** option 1, unchanged, but for a different reason than the
first version gave. It is still the precondition (80% of `lodging` and `food`
candidates are uncheckable), and it is cheap. What changed is what follows it:
option 3 **scoped to `lodging` and `food`** is no longer ruled out by these
numbers, only unproven on three events. So the sequence I recommend is option
1, re-measure the stratum on its named premises, then decide between a scoped
option 3 and option 4 on that sample. Option 2 is not supported by anything
here. If the owner would rather not spend a live run, option 4 is defensible
only for the population-weighted case, not the scoped one. This remains the
owner's decision.

_Round 1 (after gate 1 at 88fb17a6)._ Fixed: the three meds above (the units
and the bar, the 80% population, `rubric.written`); the per-family counting
departure; 58 objects and the arithmetic (13.8 and 9.8 are gate figures, and
the Log now counts searches per defect _found_); the Fumoir date and the
Bonaventure note; the doc-comment placement; and Grande-Grève's queries, re-run
as written. Not changed, by the owner's choice: the classification and the
sample (the sensitivity line above). Gate 1 also noted that the evidence field
is named `readOn` though 119 of 121 rows were read from a search-result
snippet; the Log already says so, and several sources (a 2018 listing, a 2019
article, a 2023 release) show a place exists and not that it operates, so
`closed` may be undercounted.

**Defects met in the skill's pages** are in the builder's report to the
orchestrator, not here.

- 2026-10-17 — Fixed at landing by owner choice: gate 2, finding 1 — "the Log's
  units paragraph says 'without the three parks' objects the stratum is 3 of 14
  objects, 21.4% (7.6–47.6)'. It should say 3 of 16, 18.8% (6.6–43.0)."
  Counted in the text before these entries (the ticket cut at its first "Fixed
  at landing" line, then `grep -c` of each phrase): `stratum is 3 of 14$` 1
  before, 0 after; `21.4% (7.6` 1 before, 0 after; `18.8% (6.6–43.0)` 0
  before, 1 after; `stratum is 3 of 16$` 0 before, 1 after. The record is Log
  wording only and was not regenerated.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, finding 2 — "'Five of
  the 28 stratum keys are parks', in the units paragraph and in option 3,
  should be six." Counted the same way: `Five of the 28 stratum keys` 1
  before, 0 after; `five of the stratum's 28` 1 before, 0 after;
  `Six of the 28 stratum keys` 1 after; `six of the stratum's 28` 1 after. The
  parenthetical after the units-paragraph count still lists five parks (four Parc national de la
  Gaspésie keys and Parc du Bic); the gate's finding names the count and not
  the list, so the list was left as written and does not name the sixth,
  `forillon national park|gaspé`.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, finding 3 — "two
  figures are labelled wrongly: the units table is said to be 'every figure
  printed by the harness', but its per-key total (5 of 121, 4.1%, 1.8–9.3) is
  not in the harness output; 'about 15 searches per defect found' sits under
  the population-weighted bullet but is computed from the unweighted 4 of 58."
  The table's lead-in now says the last four rows are printed by the harness
  and the first two are not; the "about 15" is labelled as the unweighted
  per-object figure (6.9%). Check mode printed the per-family table, the two
  strata (28 and 93 keys) and the per-object line (58 objects, 4 of 58; stratum
  19 objects, 3 of 19), and not the per-draw total (5 of 150, 3.3%) either:
  `grep -c "3\.3%\|4\.1%\|5 of 121\|5 of 150"` on its output → 0. The per-draw
  row is the lander's finding beyond the gate's, which named only the per-key
  total. Counted the same way: `^is printed by the harness, ` 1 before, 0
  after; `in the last four rows is printed` 1 after;
  `defects in 58 objects it is about 15` 1 before, 0 after;
  `(the unweighted$` 1 after. "About 6 to 7 per defect" was left alone.
- 2026-10-17 — Owner's answer to the open decision (step 7, which existence
  check to build, if any). The options put on 2026-10-17 were option 1, make
  `lodging` and `food` proposals specific first, then re-measure the stratum
  and choose between a scoped lookup and closing the item; option 3, a lookup
  scoped to `lodging` and `food`, built now; option 4, close §5 item 3; or
  decide later. Option 2 was not offered, because this Log found nothing to
  support it. **The owner chose option 1**, the builder's recommendation, so
  nothing was overridden. The cost of the live re-measure run was stated as
  unmeasured. Nothing of option 1 is built here. A follow-up ticket for it
  will be filed separately, not in this pull request.
