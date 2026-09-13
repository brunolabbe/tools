---
id: pl-39
tool: planner
title: A real model behind the seam — Anthropic, structured replies, a bounded bill
kind: work-package
status: ready
milestone: P3
depends_on: []
difficulty: hard
---

# pl-39 — A real model behind the seam

**Packages:** `agent`, `api` (plus the deployment document and the architecture's
env table)

## Why

**P3 says "against a real model", and nothing in this tool can reach one.**
Every ticket under the milestone is closed and `npm run status` calls it
complete, but `createModelProvider` in `api/src/server.ts` has one case,
`scripted`. The grounding half of "the plan is true" is real — Valhalla, a
geocoder, Overpass — and every candidate it grounds was written by a script.
[02-ROADMAP.md](../02-ROADMAP.md)'s P3 line is a claim about a model the tool has
never called.

Two closed tickets say in their Logs that they stopped at exactly this wall.
[pl-29](./pl-29-detours-along-a-leg.md) proved a hostile place name reaches the
prompt verbatim inside its warning block, and recorded that "the scripted model
provider cannot be 'instructed' by anything, so no test in this repo can prove a
real model resists this string". [pl-36](./pl-36-more-osm-attribution-gaps.md)
parked a provenance join until "a labelled corpus of real specialist replies
generated with actual `finds` in the prompt" exists. The roadmap's first _Still
open_ item — whether a specialist grounds for itself — is a question about tool
use on `ModelProvider`, and is not answerable against a script either.

This ticket is the adapter. **Proving the milestone against it is
[pl-40](./pl-40-prove-p3-against-a-real-model.md)**, split out because that
proof needs a key and money, and CI has neither and must never spend either.

### What was decided, 2026-09-13, and by whom

The repo owner chose, from options with measurements attached:

- **Anthropic, default model `claude-opus-5`**, configurable per deployment.
- **Structured outputs through the seam** rather than prompt-JSON and re-ask.
- **Adaptive thinking at effort `low`, and `MAX_OUTPUT_TOKENS` raised from 2,048
  to 8,000.**
- **Two tickets**: this one, and pl-40 for the live proof.

The measurement behind all four, taken with the real `systemPrompt` and
`userPrompt` over the six `contract/test/fixtures/*.json` briefs and
`SCRIPTED_FAN_OUT` standing in for replies. Token counts are characters ÷ 4,
because the dev container has no key and `count_tokens` answered 401:

| Quantity                              | Measured                                   |
| ------------------------------------- | ------------------------------------------ |
| Specialists per run                   | 4–6 by shape                               |
| Input per specialist call, no finds   | ≤ ≈783 tokens                              |
| Reply JSON per call, no thinking      | ≤ ≈909 tokens                              |
| Mean run                              | ≈3.7k in, ≈2.1k out → **≈$0.07** on Opus 5 |
| Ceiling at 5 × 2 attempts × 8k output | ≈80k out → **≈$2.30** a run, worst case    |

**The input row is a fixture run, and a corridor run is not that shape.**
`FixtureGroundingProvider.nearby` answers `[]`, so none of those prompts carried
a discovery block — and nothing caps how many finds reach one:
`agent/src/grounding.ts` bounds each find's name and tags, not the list. The one
real capture, `api/test/fixtures/overpass-nearby.json`, has 276 named elements,
which [pl-40](./pl-40-prove-p3-against-a-real-model.md) estimates at up to
≈10.7k input tokens per finds-reading call. Nothing in this ticket depends on
that number, but no sentence here should be read as "input is negligible".

The 2,048 cap was the trap that forced the thinking decision: Opus 5 thinks by
default, thinking tokens count against `max_tokens`, and a 909-token reply plus
any thinking at all is a `length` stop, a re-ask, and the worst case billed on
an ordinary trip.

## Build

1. **Add `@anthropic-ai/sdk` to `@planner/agent`'s `dependencies`.** It is not
   in the lockfile today. Install it with `--ignore-scripts`: `ffmpeg-static`'s
   postinstall fetches from the network, and when that fails npm rolls the whole
   reify back. **The lockfile diff should add the SDK and its own dependencies
   and nothing else** — read it before committing. The SDK's zod peer range is
   `^3.25.0 || ^4.0.0`, and `agent` is on zod 4.

2. **`agent/src/provider.ts` — the seam gains a reply schema.** `ModelRequest`
   takes an optional `replySchema`. The seam's own header says tool use and
   streaming "will land here … add them when the caller exists". A caller exists
   for this one: `askSpecialist` already validates against
   `specialistReplySchema`, and this change sends the same schema ahead of the
   reply instead of only checking it behind. Carry the **zod schema**, not a
   JSON Schema object. `agent` already depends on zod, the adapter needs the zod
   original to use the SDK's helper, and a provider that cannot enforce a schema
   ignores the field. **The scripted provider ignores it and must not change
   behaviour**; its suites are the proof.

3. **`agent/src/ask.ts` passes `specialistReplySchema` on every attempt, and
   changes nothing else.** `extractJson`, `parseReply`, the zod validation and
   the re-ask all stay. _A model reply is untrusted input_ is this file's first
   rule. Structured outputs is a vendor's promise about the shape, not this
   tool's check of it, and the refinements it cannot send (below) are only
   enforced here.

4. **`agent/src/providers/anthropic.ts` — `AnthropicProvider implements
ModelProvider`.** It lives beside `scripted.ts` rather than under
   `api/src/grounding/`'s precedent, because `agent` is "everything that talks
   to a model" and this is that. `createModelProvider` stays the only place that
   picks it by name. What it does:
   - **Construct the client with an explicit `apiKey`, `timeout` and
     `maxRetries`** from its options. With no `apiKey` the SDK reads
     `ANTHROPIC_API_KEY` from `process.env` itself, and `api/src/config.ts` is
     the only file in the tool that may read the environment.
   - **Request:** `model`; `max_tokens` from `maxOutputTokens`; `system`;
     `messages`; `thinking: { type: "adaptive" }`; `output_config: { effort,
format }`, with `format` from the SDK's zod helper
     (`@anthropic-ai/sdk/helpers/zod`) when `replySchema` is set; and
     `signal`.
   - **Refusal fallbacks on**: `fallbacks: "default"` behind beta header
     `server-side-fallback-2026-07-01`, which is the beta `messages` path.
     Confirm the installed SDK types the scalar form. If they do not, stop and
     say so rather than casting around it.
   - **Reply:** `content` is the concatenated `text` blocks only; thinking blocks
     are dropped. `stopReason` maps `end_turn` → `end`, `max_tokens` →
     `length`, `refusal` → `refusal`. Anything else (`pause_turn`, `tool_use`,
     `stop_sequence`) means this request produced something it should not have
     been able to — no tools and no stop sequences are sent — so it is an
     `AGENT_MALFORMED_REPLY`, not a silent `end`. `usage` from `input_tokens` +
     `cache_read_input_tokens` + `cache_creation_input_tokens` and
     `output_tokens`, which already includes thinking.
   - **Errors, by SDK class, most specific first** — never by message string:

     | SDK                                              | Code                 | Why                                                                       |
     | ------------------------------------------------ | -------------------- | ------------------------------------------------------------------------- |
     | aborted by `signal`                              | `CANCELED`           | A canceled run, not a failed one                                          |
     | `APIConnectionTimeoutError`                      | `TIMEOUT`            | Core's, retryable                                                         |
     | `RateLimitError`                                 | `RATE_LIMITED`       | Core's, retryable                                                         |
     | `AuthenticationError`, `PermissionDeniedError`   | `AGENT_UNCONFIGURED` | A bad key is the server's configuration, and the user's copy says so      |
     | `BadRequestError` naming the context             | `CONTEXT_LIMIT`      | Only when the error type says so; a guessed match is how a real 400 hides |
     | `InternalServerError`, 529, `APIConnectionError` | `AGENT_UNAVAILABLE`  | Vendor down, not this tool broken                                         |
     | anything else                                    | `INTERNAL`           | Logged with status and request id, never with headers                     |

     Check each code's retryability against `RETRYABLE_CODES` rather than
     assuming it. The SDK's own `maxRetries` already retries 429 and 5xx, and
     a second retry layer above it multiplies wall-clock, not success.

5. **`api/src/config.ts`.** `MODEL_PROVIDERS` gains `anthropic`. New settings,
   read here and nowhere else:
   - `ANTHROPIC_API_KEY`, no default;
   - `MODEL`, default `claude-opus-5`, which is ignored under `scripted`;
   - `MODEL_EFFORT`, default `low`, one of `low | medium | high | xhigh | max`;
   - `MODEL_TIMEOUT_MS`, justified the way `groundingTimeoutMs` is;
   - `API_DEFAULTS.maxOutputTokens` goes to `8_000`, and so does
     `DEFAULT_RUN_BUDGET.maxOutputTokens` in `agent/src/budget.ts`, which
     duplicates it on purpose (its comment says why).

   The key is a string on the config object, so **the config object is never
   logged whole** — the boot line `"agent configured"` in `api/src/server.ts` logs `provider` and `model` only today, and
   a test should keep it that way.

6. **`api/src/server.ts` — `createModelProvider` gains `case "anthropic"`**,
   and **refuses to boot without a key**, the way `requiredEndpoint` refuses
   `valhalla` without `VALHALLA_URL`. A service that boots and fails its first
   run is worse than one that does not start.

7. **An unknown `MODEL_PROVIDER` stops falling back to `scripted` silently.**
   [pl-8](./pl-8-model-provider-seam.md)'s Log predicted this: "that stops being
   true the day a second provider exists". `MODEL_PROVIDER=antropic` on a
   production host would run the script and bill nothing while looking
   configured. Refuse to boot on an unrecognised name. Decide
   whether `groundingProvider` gets the same treatment in this commit or a
   ticket, and say which in the Log. It has the same silent fallback, and it has
   had two real backends' worth of chances to bite.

8. **Health needs nothing new.** It already reports `agent: { provider, model }`,
   which becomes `anthropic` / `claude-opus-5`. Assert it.

9. **Deployment.** `docs/02-DEPLOYMENT.md` names `MODEL_PROVIDER`,
   `ANTHROPIC_API_KEY` (as a secret, never in a compose file checked in), `MODEL`
   and `MODEL_EFFORT` for the planner. The architecture's env table
   ([01-ARCHITECTURE.md](../01-ARCHITECTURE.md) § Configuration) gains the same
   rows. The `Dockerfile`'s `ENV MODEL_PROVIDER=scripted` stays: a real model is a
   deliberate act per deployment.

## Traps

- **`RUN_TOKEN_BUDGET` silently buys a quarter as many specialists.**
  `runBudgetFor` divides it by `maxOutputTokens × 2`, so raising the cap from
  2,048 to 8,000 cuts a deployment that set the budget from, say, 5 specialists
  to 1, with no error — just `specialist-dropped-for-budget` gaps. Say so in
  the deployment doc and in the Log. Do not "fix" the arithmetic here: it
  ignores input tokens too — 26% of a fixture run's dollars by the table above,
  and more on a corridor — and whether that needs fixing is pl-40's measurement
  to take.
- **Prompt caching is not in this ticket.** A `cache_control` on the system
  block would make a re-ask's input read at a tenth of the price, and every
  first attempt that is never re-asked would pay the 1.25× write for nothing.
  Which wins depends on the re-ask rate under structured outputs, which nobody
  has measured; pl-40 does.
- **Structured outputs cannot carry this tool's schema whole.** The API rejects
  `minimum`/`maximum`, `minLength`/`maxLength`, complex array constraints and
  anything but `additionalProperties: false`, and `candidateSchema` uses all
  of the first four, plus `.regex` and a `.refine` — declared not on
  `candidateSchema` itself but on the schemas its fields reach:
  `costEstimateSchema` (currency regex, `high >= low` refine) and
  `seasonWindowSchema` (month-day regex). The SDK helper strips what the API does not support and validates
  it client-side; a `.refine` does not survive JSON Schema at all. That is why
  step 3 keeps zod validation authoritative. **Prove it with a test**: a reply
  that satisfies the stripped JSON Schema and fails the refine (`high < low`) is
  still refused.
- **`candidateLocationSchema` and `provenanceSchema` are discriminated unions**,
  which become `anyOf` — supported — but check that the helper emits them rather
  than falling back to something looser. Snapshot the JSON Schema it produces
  for `specialistReplySchema`, so a zod or SDK upgrade that changes it shows up
  as a diff.
- **A fallback can answer as another model.** With `fallbacks: "default"` the
  reply's `model` may not be `claude-opus-5`. Health reports what is configured,
  which is correct, but "which model answered" is the first question about a bad
  candidate and `ModelProvider.model` cannot answer it for one reply. So
  **`ModelReply` gains an optional `servedModel`**, set from the response and
  logged when it differs; pl-40 records it, and must not have to reach around
  the seam for it. The cost side matters too: a refusal mid-reply bills the
  partial output **and** the fallback model's whole reply at that model's
  prices, so one attempt can bill up to twice `maxOutputTokens`.
  `usage.output_tokens` must be the sum across both, which means reading the
  response's usage iterations rather than the top-level count if the two differ
  — check the fixture, and say in the Log which it was.
- **No live calls in any test.** The SDK takes a custom `fetch`. Answer it from
  JSON fixtures of Messages API responses and errors: an ordinary reply, a reply
  with thinking blocks, `max_tokens`, `refusal`, a fallback-served reply, 429,
  401, 529, a timeout. **These fixtures are hand-written from the documented
  shape, not captured**, because no key exists where this is built. Say that in
  the fixture file's header. [pl-28](./pl-28-valhalla-adapter.md)'s rule is that
  fixtures come from real payloads, and pl-40 is where captured ones replace or
  confirm them.
- **The key must not reach a log line through an error.** SDK errors carry the
  request, and the request carries `x-api-key`. `logger.ts` already censors
  `headers['x-api-key']` as a backstop, but log the error's status, type and
  request id, never the error object. A test logs a thrown 401 through the real
  logger and asserts the key string is absent from the output.
- **`thinking: { type: "disabled" }` is not an escape hatch here.** On Opus 5 it
  is accepted only at effort `high` or below, and with thinking off the model can
  leak tags into its text, which step 3's validation would then reject as
  malformed. If `MODEL_EFFORT` and thinking ever need to vary independently,
  that is a new decision, not a config combination.

## Done when

- `MODEL_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` set boots, and `/api/health`
  reports `anthropic` and `claude-opus-5`; without the key it refuses to boot,
  naming the variable. Proven by tests over `loadApiConfig` and
  `createApp`/`createModelProvider`.
- An unrecognised `MODEL_PROVIDER` refuses to boot rather than running `scripted`.
- `AnthropicProvider` against fixture responses: sends `specialistReplySchema` as
  `output_config.format`, `thinking` adaptive, the configured effort, `fallbacks:
"default"` with its beta header, and the explicit key; maps every stop reason
  and every error row in step 4's table, each by its own test.
- A reply that passes the JSON Schema sent and fails `costEstimateSchema`'s refine is
  refused by `askSpecialist`, and re-asked exactly as before.
- The JSON Schema emitted for `specialistReplySchema` is snapshotted.
- A thrown authentication error logged through the real logger does not contain
  the key.
- The scripted provider's suites and the planner e2e suite pass unchanged —
  the seam change is invisible to everything that does not opt in.
- `MAX_OUTPUT_TOKENS` defaults to 8,000 in both places; the `RUN_TOKEN_BUDGET`
  consequence is written in `docs/02-DEPLOYMENT.md`.
- The lockfile adds `@anthropic-ai/sdk` and its own dependencies only.
- `npm run check` and `npm test -- --project planner` pass; the image builds
  (`.github/workflows/planner.yml`).

## The gate on this filing

**2026-09-13, Sonnet, read-only, asked to falsify every checkable claim.** The
brief was written on Opus. It is recorded here and not under `## Review`,
because there is no work yet to review.

**Result:** 25 claims checked, and none falsified. They cover the code facts,
the lockfile and postinstall, the 4× `RUN_TOKEN_BUDGET` arithmetic
(`RUN_TOKEN_BUDGET=20,000` affords 4 specialists at 2,048 and 1 at 8,000), the
premise that no real provider exists on any branch or open pull request, and
every SDK and API detail. The SDK details were checked against the published
`@anthropic-ai/sdk@0.125.0` source, including the helper's JSON Schema
stripping in `src/lib/transform-json-schema.ts`.

Two `low` findings, both fixed in the filing commit:

- **The "~15% of a happy run" input figure did not reconcile with the table.**
  It is corrected to 26% of a fixture run's dollars. pl-40's grooming reached
  the same correction independently.
- **The `.refine` and the regexes were attributed to `candidateSchema`.** They
  are declared on `costEstimateSchema` and `seasonWindowSchema`, which its
  fields reach. The Traps text and the Done-when line now name those.

Separately, pl-40's grooming found that the input figures were taken with no
finds in the prompt. The table now says so, and that finding is
[pl-41](./pl-41-every-find-reaches-the-prompt.md).

## Log

**2026-09-13 — filed.** From a roadmap review that found every planner ticket
closed and P3's "against a real model" never exercised. Scope, model, reply
enforcement, thinking and the split were put to the owner as options, with the
measurement above, and the recommended option was taken on each. No code was
written; the id was checked with `node scripts/next-id.mjs pl`, which reported
`pl-39` free.
