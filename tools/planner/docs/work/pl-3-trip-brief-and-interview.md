---
id: pl-3
tool: planner
title: The trip brief, and the interview that fills it
kind: work-package
status: ready
milestone: P2
depends_on: [pl-1]
---

# pl-3 — The trip brief, and the interview that fills it

**Packages:** `contract`, `agent`, `api`, `web`

## Why

Trip types share almost nothing — a skidoo weekend lives on snow base and fuel
range, a Rome week on opening hours and walkability
([00-ANALYSIS.md §1](../00-ANALYSIS.md)). A form that asks every question in that
table is a form nobody finishes, so which questions get asked has to be a
function of the answers so far.

The output is what matters more than the interview. A **`TripBrief`** — validated,
structured — is the only thing a specialist ever sees (§3, §4). That indirection
is what makes the fan-out testable: given a checked-in brief, the roster is
deterministic and a unit test can assert it, and the interview can later be
replaced by a form or an import without a specialist noticing.

## Build

The contract comes first and gets agreed before the rest starts: four packages
will depend on this shape, and the root `CLAUDE.md` forbids editing a contract
unilaterally.

1. **`contract` — `TripBrief`.** The fixed core every trip needs: party (count,
   ages that matter, accessibility), dates and their flexibility, origin, budget
   shape, appetite for effort and for discomfort, hard deal-breakers. Then a
   `TripShape` enum — road trip · backcountry · motorised touring · city and
   culture · resort · multi-city — and a per-shape extension holding that shape's
   answers. Write each schema `satisfies z.ZodType<T>` as `api.ts` already does.
   Every slot is explicitly _unknown_, _asked-and-declined_ or _answered_: "the
   user does not care" is an answer and must not be re-asked.
2. **`contract` — completeness as a function.** `missingRequiredSlots(brief)`
   returns which slots block a first draft, per shape. This is the interview's
   stopping condition and it belongs in the contract, not in a prompt — asking the
   model whether it has enough invites it to say yes (§3).
3. **`agent` — the interviewer.** Given the transcript and the current brief,
   return the next question set (at most three) plus the slot updates it just
   learned, as a schema-validated object. Two rules from the analysis:
   classify the shape early, and stop as soon as a first draft is possible rather
   than at completeness — people react to a draft better than they answer
   questions (§3).
4. **Reply validation is not optional.** The interviewer's output reaches SQL and
   the UI. Validate against the contract schema; `AGENT_MALFORMED_REPLY` past the
   retry budget. Re-ask inside the agent with the failure fed back — do not replay
   the request from the top.
5. **`api`** — a `briefs` table (one per conversation, for now), a migration in
   the existing numbered sequence, and routes to read the brief and to advance the
   interview. The brief is server-owned state: the client sends answers, never a
   brief.
6. **`web`** — render the current question set and the brief as it fills. Showing
   the brief is not a debug view; it is how a user notices the tool misheard them,
   and it should be editable for exactly that reason.
7. **Extend the scripted provider** with an interview script that walks one shape
   to a first-draft-ready brief, so the whole path is deterministic in CI with no
   key.

Traps worth knowing in advance:

- **Do not let the shape classification be one-shot and final.** People describe a
  road trip and turn out to mean a hiking trip with a drive at each end. Re-classify
  each turn; changing shape must keep the core slots and swap only the extension.
- **Dates are the field most likely to be wrong** and `INVALID_DATES` already
  exists for it. Flexibility ("a weekend in February") is a first-class case, not
  a missing date.
- **The brief will want fields nobody thought of.** Add them here rather than
  smuggling free text into a `notes` blob that later has to be parsed back out.

## Done when

- A conversation started in the UI reaches a brief that `missingRequiredSlots`
  reports as draft-ready, in under a dozen questions, against the scripted
  provider.
- Unit tests: `missingRequiredSlots` per shape, a shape change that preserves the
  core, a malformed interviewer reply raising `AGENT_MALFORMED_REPLY` after its
  retries, and the brief surviving a reload.
- No specialist, roster or plan code lands in this ticket. It stops at the brief.
- `npm run check` and `npm test -- --project planner` pass.

## Log

_Not started._
