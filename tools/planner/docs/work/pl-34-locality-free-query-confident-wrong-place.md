---
id: pl-34
tool: planner
title: A locality-free geocoder query resolves confidently to the wrong country
kind: fix
milestone: P3
status: done
depends_on: []
---

# pl-34 — A locality-free geocoder query resolves confidently to the wrong country

## Why

pl-30 captured real Nominatim `/search` replies to hold `firstCoordinates` in
`api/src/grounding/valhalla.ts` to something other than memory. The parser
came through clean — a no-match is a real `[]`, `lat`/`lon` are real strings,
both already handled. What the captures exposed instead is upstream of the
parser, in the **query** `locate` sends, and it is worse than the failure
pl-30's brief predicted.

pl-30 predicted "Saint-Jean in Québec becomes Saint-Jean in New Brunswick" —
still Canada, still plausible, the kind of wrong a reader might catch on a
map. The captured reply says the real failure is not that: `q=Saint-Jean` with
no locality returns Saint-Jean, **Toulouse, France**, and raising `limit` to
10 does not recover a Québec result at all — it recovers New Brunswick,
Newfoundland, Jersey, Belgium and Kinshasa, matched across languages
(`Sint-Jan`, `St John`), and no Canada-adjacent guess is even close.

**This is reachable in production, not a corner someone would need to
construct.** `Place.locality` is `string | null`
(`tools/planner/contract/src/candidate.ts:263`), and `placeQuery` in
`valhalla.ts` filters empty parts before joining `name` and `locality` — so a
candidate whose `locality` is `null` sends the geocoder the bare `name`:

```ts
function placeQuery(place: Place): string {
  return [place.name, place.locality]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(", ");
}
```

A model omits `locality` routinely — it is optional in the contract and
nothing today requires a specialist to fill it. The result is not a `null`
`LocatedPlace` and not an `UncheckedConstraint`: it is a **confident, sourced,
wrong coordinate**. `pointsOf` sends it, `travel` measures a real distance to
it, and the plan reports `travel-time` as `measured` between (say) Montréal
and a point in France. pl-27's gap vocabulary has nothing that names this,
because from the plan's point of view nothing went wrong — a place was
located, a leg was measured, a source is attached. The wrongness is entirely
in which place got located.

## Reproduction

Pinned as tests in `tools/planner/api/test/grounding-valhalla.test.ts`
(`describe("locate, over a payload a real Nominatim wrote")` and
`describe("what the ambiguous-name replies show, beyond what locate reads")`),
over the real captures pl-30 checked in:

- `nominatim-search-ambiguous-limit1.json` — `q=Saint-Jean&limit=1`
  (production's actual request shape: `locate` always asks for `limit=1`).
  First and only result: Saint-Jean, Toulouse, Haute-Garonne, France —
  `lat=43.6648247, lon=1.5041143`. A `locate` call for
  `{ name: "Saint-Jean", locality: null }` resolves to exactly this,
  non-null, sourced.
- `nominatim-search-ambiguous-limit10.json` — the same query at `limit=10`,
  captured only for this ticket's evidence (`locate` never requests more than
  one). None of the ten results is in Québec. The six distinct places are
  Toulouse (France), Saint John (New Brunswick), St. John's (Newfoundland),
  St John (Jersey), Sint-Jan (Belgium) and Lingwala (Kinshasa) — Nominatim
  matched across languages and place types, not just across Canadian
  provinces.
- The ten results are **not ordered by `importance`**: the highest
  (`0.6016`, St. John's, Newfoundland) is at index 2, behind `0.5848`
  (Toulouse, the one actually returned at `limit=1`) and `0.5813` (New
  Brunswick). So "ask for more and take the best-scored one" is not free —
  Nominatim's own ranking already put Toulouse ahead of both Canadian
  results at `limit=1`, and "first" and "best" are not the same claim even
  inside one reply.

## What this is not

- **Not a `firstCoordinates` defect.** The parser reads `body[0]` correctly;
  the reply's `body[0]` is simply the wrong place. Nothing in
  `api/src/grounding/valhalla.ts`'s reply-parsing changed for this ticket.
- **Not the pl-30-predicted failure mode**, which was a same-country
  near-miss. This capture did not exercise "`locality` present but the
  geocoder still picks the wrong same-name place inside one country" — that
  remains a real, separate risk this ticket does not have evidence for either
  way.
- **Not something `pointsOf` or `travel` can catch downstream.** Both receive
  a `Place` that is fully formed — coordinates, a source, nothing marked
  uncertain — because the wrongness happened one layer up, in what `locate`
  was asked.

## Options — none chosen here

1. **Require a locality before geocoding.** Refuse (or fall back to
   `UNCHECKED`) a `locate` call for a place with `locality: null`, and push
   the requirement upstream — either the contract stops treating `locality`
   as optional, or specialists are prompted/validated to fill it. Closes the
   exact case reproduced here. Does not help when `locality` is present but
   still ambiguous (the pl-30-predicted case), and costs whatever the tool
   loses by refusing to locate a place a model genuinely could not name a
   locality for.
2. **Raise the request `limit` and disambiguate on `display_name`.** Ask for
   more than one result and pick the one whose `display_name` best matches
   what is known about the place (country, region, the brief's destination)
   rather than trusting Nominatim's own order. Works with or without a
   `locality`. Costs a scoring rule that is itself a small parser with its
   own edge cases, and this capture already shows the naive version of it
   (highest `importance`) would still have picked a European result over
   both Canadian ones.
3. **Reject a result whose `display_name` omits the locality.** When
   `locality` is present, require it (or a normalised form of it) to appear
   in the candidate's `display_name` before accepting the result; otherwise
   answer `null` rather than a guess. Cheap and directly closes the
   pl-30-predicted case. Does not touch the case reproduced here, since it
   only fires when `locality` is present — `Saint-Jean` with no locality has
   nothing to check the reply against.

These are not mutually exclusive — (1) and (3) address different halves of
the same failure and (2) is an alternative to both. Choosing between them,
and what a rejected/refused `locate` should mean for the plan (a new
`UncheckedConstraint`? a different one from the existing `travel-time`?), is
this ticket's Build, not written here.

## Build — option 2, decided 2026-08-30 by the user

**Raise the request `limit` and disambiguate on `display_name`.** In
`api/src/grounding/valhalla.ts`:

1. Ask the geocoder for ten results rather than one.
2. Choose among them by matching the candidate's own `locality` against each
   result's `display_name` — not by Nominatim's order and not by `importance`,
   both of which this ticket's capture already shows would pick a European
   result over both Canadian ones.
3. Where nothing separates the results and nothing points at one of them, do
   not answer. `locate` says `null`, as it already may.

(3) closes option 3 as a side effect: it comes out of the same scoring rule
rather than being a second rule, so it is folded in rather than left filed.

**Amended 2026-08-30, after the captures landed.** A fourth step, added
because the first three declined an ordinary lookup:

4. When the locality has narrowed the reply and the survivors _still_
   disagree, break the tie on `addresstype` — prefer settlement types over
   large-area features — and require agreement again. Only then: a reply that
   nothing has narrowed is not eligible, or the tiebreak starts answering
   "where" instead of "what kind". `Gaspé, Québec` (town vs peninsula, 118.6
   km) is what it fixes; bare `Percé` (town in Québec vs county in Idaho, 3882
   km) is what it must not touch. Both are captured.

## Done when

- A decision is recorded for which of the options above (or a fourth) closes
  this gap, with the tradeoffs above weighed rather than re-derived.
- The chosen fix is implemented and the reproduction above (or an equivalent
  captured case) is pinned as a test that fails without it.
- If the fix changes what `locate` or `travel` can return, `@planner/contract`
  and pl-27's `UncheckedConstraint` vocabulary are updated to say so, rather
  than silently returning `null` for a case the plan should be able to name.

## Log

**2026-08-29 — filed from pl-30's real captures, per the coordinator's
direction, id held rather than computed.** The coordinator reserved `pl-33`
for another in-flight planner ticket at the time of filing this one; it is
not visible anywhere in this repository's history (gate 2 checked
`git log --all`, every branch and every open pull request and found no
reference to it), which is expected for an id reserved but not yet landed —
if it goes unused it will be reclaimed. That is the coordinator's own claim,
carried here rather than independently sourced, and stated as such rather
than as a fact this repository's history can confirm. No fix attempted here
— see "Options" above. The claim this ticket exists to
carry forward is narrow and load-bearing: **`firstCoordinates` was already
correct; the query was not.** Verified independently before filing:

```
$ grep -rn "place_id" tools/planner/api/src
(no output)
```

Nothing in this tool reads Nominatim's `place_id` at all, so claim 4 from the
capture (`place_id` differs between the two captures for the same `osm_id`)
is informational for this ticket and not a live defect — noted rather than
acted on. `api/src/grounding/cache.ts`'s `locateKey`/`travelKey` are keyed on
the requested `Place`, never on anything the reply returns.

**2026-08-30 — option 2 built, reproduction pinned red first.** Branch
`pl-34-locality-free-query-disambiguation`, cut from `origin/main`. `locate`
asks for ten results and `chooseResult` picks among them; before this it asked
for one and answered `body[0]`.

The reproduction was written and watched fail before any source changed: six
tests red at `d3feb4b`'s parent, including
`locate({ name: "Saint-Jean", locality: null })` over
`nominatim-search-ambiguous-limit10.json` answering Toulouse, France where it
must answer nothing.

**The rule, and why it is not the naive version.** Each comma-separated
fragment of `locality` is an unlabelled hint; a result scores one point per
hint appearing in its `display_name`, folded to lowercase with diacritics
stripped so `"quebec"` matches `"Québec"`; the highest-scoring results survive
and a result matching nothing does not; the survivors must then agree about
where they are, within 25 km, or the place is not located. That last clause is
the whole of the answer when `locality` is `null`, which is the case this
ticket was filed for.

Nothing here reads `importance` and nothing reads Nominatim's order except as
a tiebreak among results that already agree. The brief is right that the naive
version fails and it understates it slightly: `importance` would have picked
**St. John's, Newfoundland** (0.6016, index 2), and taking the first would
have picked **Toulouse** — three different answers from one reply, none of
them a Québec place, which is pinned as a test rather than asserted.

**What the brief had wrong or left stale.**

- _"The ten results"_, said four times. The captured
  `q=Saint-Jean&limit=10` reply holds **six** results; the brief's own
  "the six distinct places are…" is the accurate sentence and the counts
  elsewhere are not. The test names in `grounding-valhalla.test.ts` now say
  six and the file's header says why.
- _"production's actual request shape: `locate` always asks for `limit=1`"_
  and _"captured only for this ticket's evidence"_, of the two captures. As
  of this commit that is exactly inverted: `limit=10` is production's shape
  and the two `limit=1` captures are the historical one. Both statements were
  true when written; they are recorded here rather than edited out of the
  Reproduction section, which is that section's job.
- _Option 3 described as untouched by option 2_ — "does not touch the case
  reproduced here". True of option 3 alone, but option 2's scoring produces
  option 3 for free: a result that mentions none of the locality's hints is
  refused whether or not there is anything else in the reply. The
  pl-30-predicted failure (`{ name: "Saint-Jean", locality: "Québec" }`
  answering Toulouse) is closed by this commit and pinned over the real
  `limit=1` capture. **No separate ticket for it.**

**Three fold-ins, all in this commit.** The stale `firstCoordinates`
reference in `api/src/runs/discovery.ts`'s header (the function is now
`geocoderResults`), the two stale claims about the captures in the test
file's header, and option 3 above. A fourth was declined: `MIN_HINT_CHARS`
and the 25 km radius are the kind of constant `docs/01-ARCHITECTURE.md` might
mention, and it does not mention the geocoder's request shape at all today, so
adding a first mention of it there is a documentation change with no ticket
behind it rather than a stale sentence being fixed.

**Every rule was mutation-checked, and one mutant survived long enough to be
worth writing down.** Six mutations run individually against the spec:
dropping the diacritic fold, a zero agreement radius, `score > 0` instead of
`score === top`, a constant `top = 1`, and `MIN_HINT_CHARS` at 0 all failed a
named test. `if (top === 0) return []` mutated to `return [...results]`
**passed all 54 tests** — because in every ambiguous case the survivors then
disagree geographically and the answer is `null` either way. The case that
distinguishes them is a _lone_ result that contradicts the locality, which is
precisely the pl-30-predicted failure, and it now has its own test over the
real `limit=1` capture (`one result that contradicts the locality is refused,
not accepted for being alone`). Without that mutation the ticket would have
shipped believing option 3 was covered when only its ambiguous half was.

**What is unmeasured, named rather than reasoned about.**

- **No successful lookup has been captured at `limit=10`.** This container
  reaches no geocoder — verified again today: `example.com`,
  `en.wikipedia.org` and `download.geofabrik.de` all fail to connect while
  `registry.npmjs.org` returns 200, so it is an allowlist. What
  `q=Percé, Québec&limit=10` actually returns is therefore unknown, and the
  rule's behaviour on the ordinary case is inferred from a `limit=1` capture
  plus reasoning, not observed. **This is the ticket's largest open risk**:
  if Nominatim returns Percé's town node and its `Le Rocher-Percé` municipality
  as rows more than 25 km apart, an ordinary lookup that used to answer would
  now decline. The capture that would settle it is one command on a networked
  machine and is worth taking before this reaches a deployment.
- **How far apart a geocoder's duplicate rows for one town are** is likewise
  unsourced; 25 km is chosen inside the gap between that (single-digit km in
  any reasonable description) and the closest pair in the real ambiguous reply
  (**402 km**, St John, Jersey to Sint-Jan, Belgium — computed from the
  fixture, not estimated). Any threshold in that range decides every case in
  this repo identically. The test that pins the near side composes its two
  rows by hand and says in the test body that it is not a claim about
  Nominatim.

**For pl-36 (`travel.ts:286-310`), which is serialised behind this.** That
loop is **not touched by this commit** — no line of `api/src/runs/travel.ts`
changed, so its shape is exactly what pl-36's brief describes. What changed is
underneath it: an `outcome.kind` of `unknown` from `locate` now means either
"nobody matched this name" _or_ "several places matched and nothing separated
them". The loop maps both to `NOT_ESTABLISHED` and the plan calls the leg
unmeasured, which is truthful but coarser than it was. If pl-36 is
re-shaping that loop anyway, it is the cheapest place to carry a distinction —
see the open decision below, which is pl-36's to inherit if it is not settled
first.

**Open decision, not settled here: does an ambiguous name deserve its own
word?** `locate` answers `LocatedPlace | null` and this commit widened what
`null` covers without widening the vocabulary, which is the third bullet of
Done-when. Deliberately left for the user because it is contract-adjacent —
`@planner/agent`'s `LocateRequest`/`GroundingProvider` seam and
`@planner/contract`'s `UNCHECKED_CONSTRAINTS`, whose sibling packages depend
on both. The options are in this dispatch's report.

**2026-08-30 (round 2) — the network opened, and the capture overturned the
risk this ticket's first round named.** Ten `limit=10` queries were run
against the public Nominatim instance by the coordinating session and are
checked in under `api/test/fixtures/nominatim-search-*.json`, unedited. They
are first-hand payloads; the capture _conditions_ (host, headers) are carried
on that session's word, since this container still reaches no geocoder.

**The stated open risk was false, and this is the correction the Log exists
for.** Round 1 named its largest risk as "a town returned alongside its
containing municipality as two rows more than 25 km apart", and built
`SAME_PLACE_METRES`'s floor on it. **Nominatim does not produce that shape.**
`Percé, Québec` returns **one** row whose `display_name` is already
`Percé, Le Rocher-Percé, Gaspésie–Îles-de-la-Madeleine, Québec, Canada` — the
municipality is inside the row's own address hierarchy, not beside it. Six of
the ten replies are single-row for the same reason. The hand-composed
two-row test that pinned that floor is kept and relabelled: it no longer
claims to imitate a reply, it pins a deliberate margin that no capture
supports.

**The regression was real anyway, through a shape nobody predicted.**
`Gaspé, Québec` returns two rows — the town `Gaspé, La Côte-de-Gaspé, …` and
the peninsula `Gaspésie, Québec, Canada` — **118.6 km** apart. Both mention
Québec, so both survive `bestMatches`; 118.6 km exceeds the threshold, so
round 1's rule declined an ordinary lookup. Measured across the ten: nine
locate, one (bare `Percé`) declines correctly, and before this commit `Gaspé`
made it eight. The mechanism is a town beside a **larger geographic feature
sharing its name**, not a town beside its own municipality.

**The fix: `addresstype`, scoped.** When the locality has already narrowed the
reply and the survivors still disagree, prefer `SETTLEMENT_ADDRESS_TYPES` —
`city`, `town`, `village`, `municipality`, every one a value a checked-in
capture carries — and require agreement again.

**The scope boundary is the part worth reading, and it is load-bearing rather
than cautious.** The tiebreak fires only when a locality hint did the
narrowing. The two fields answer different questions: the locality answers
_where_, `addresstype` answers _what kind_. Turning "what kind" loose on a set
nothing has narrowed promotes it to answering "where", which is this ticket's
own defect in a new hat. The captured proof is a bare `Percé`: the town in
Québec and Nez Perce County, Idaho, 3 882 km apart, exactly one of them a
settlement. An unscoped tiebreak answers Québec with real confidence and
nothing behind it — nothing in that request ever said Canada. It declines
instead, and three tests fail if that boundary moves.

**It is an allowlist, and that is the safety argument.** A type not on the
list is not rejected, it merely fails to be preferred — so an incomplete list
produces a place that is _not located_, never a place located _wrongly_. A
denylist of large-area features would invert that: an unrecognised type would
beat a `peninsula` on the strength of nobody having heard of it. Agreement is
also tested **before** the tiebreak, so a lone row of an unfamiliar type still
answers: captured `Saint-Jean, Québec` is `addresstype: political` and
`Charlevoix, Québec` is `county`, and both locate because there was no tie.

**`SAME_PLACE_METRES` now has a measured ceiling and a test.** The gate found
that every value from ~1.6 km to 403 km passed all 56 tests identically — the
constant was pinned by a comment and nothing else. It is now bounded from
above at **118.6 km**, because the `Gaspé` pair must read as a disagreement
for the tiebreak to run at all; a larger threshold would call them one place
and answer whichever row Nominatim sent first, which is correct today and
luck tomorrow. The test feeds the same two captured rows **reversed** and
requires the town either way — one test that bounds the constant and proves
the answer comes from the type rather than the ordering. Verified: passes at
118 km, fails at 200 km. The _floor_ is now the unsupported side, and the
comment on the constant says so.

**Mutation results, round 2.** Removing the tiebreak fails 4 tests (this is
the regression, reproduced). Unscoping it to locality-free queries fails 3,
including bare `Percé`. Dropping `town` from the allowlist fails 3. Filtering
to settlements unconditionally instead of only after a disagreement fails 5,
including three ordinary lookups. **One mutant survives and is recorded rather
than papered over:** filtering to settlements _before_ the agreement test but
only when a settlement exists is behaviourally identical on all ten captures.
It differs only for a reply mixing a large-area row and a settlement row
_within_ the threshold, where mine answers by reply order and it answers the
settlement. No capture shows that case; it is a defensible refactor rather
than a defect, and it is left alone.

**A wrong answer this ticket does not fix, named rather than absorbed.**
`Sainte-Anne, Québec` resolves to a **bus stop** in Québec City
(`addresstype: highway`, `importance` 7.2e-05), not to any town called
Sainte-Anne-something. It is a single-row reply, so there is no tie and
nothing here fires; it is the same _class_ of failure as this ticket's —
confident, sourced, wrong — reached by a different route, and closing it needs
a different instrument (a floor on `place_rank`/`importance`, or the trip
context pl-37 adds). Counted among the "nine that locate" because it returns a
point, which is exactly the sense in which that count is weaker than it reads.

**Round 1's `Percé, Québec` gap is closed.** Round 1 said no successful
lookup had been captured at `limit=10` and that the ordinary case was inferred
rather than observed. Ten now are, driven through `locate` as a block in
`grounding-valhalla.test.ts` so the next change to `chooseResult` is measured
against all of them at once.

**Follow-up filed: pl-37**, `locate cannot see the trip it is grounding` —
the user's choice from round 1's open decision. It puts the brief's
destination into `LocateRequest`, and carries the trap this round worked out:
`cache.ts`'s `locateKey` is keyed on the `Place` alone, so a seam that answers
per-trip with a key that ignores the trip serves one trip's Saint-Jean to
another's. It would also have dissolved the `Gaspé` case without an allowlist.
Id verified against `origin/main`'s work directory, every open pull request
and every ref on `origin`: `pl-36` was the highest, `pl-33` is held by another
session, so `pl-37`.

**Still not settled, and still contract-adjacent:** whether an ambiguous
`locate` deserves its own word in the seam and in `UncheckedConstraint`. Round
2 widened what `null` covers again — a declined tiebreak is a third way to get
one — without widening the vocabulary. Unfiled on purpose; it is the
alternative the user did not pick, and it belongs to whoever picks it up.
