---
id: repo-120
tool: repo
title: Move the Anthropic SDK from 0.125 to 1.x in the planner and the ledger
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-120 — Move the Anthropic SDK from 0.125 to 1.x

## Why

`@anthropic-ai/sdk` reached 1.0.0 on 2026-10-21 (1.3.0 on 2026-10-23); this tree
is on 0.125.0. Three workspaces import it: `@planner/agent`, `@planner/api` and
`@ledger/receipts`. A major release means breaking changes nobody here has read
yet, and every model call — the planner's runs and the ledger's receipt and
layout reads — goes through it.

**Not before 2026-10-28**: the rule in `.claude/rules/dependency-updates.md` keeps
1.0.0 out for seven days, and any later 1.x for seven days after its own release.

## Build

1. Read the SDK's changelog and migration notes from 0.125 to the 1.x being
   taken. List every breaking change that touches an API this tree calls —
   `grep -rn "@anthropic-ai/sdk" tools/*/*/src` is the call sites.
2. Bump the range in each of the three `package.json` files together, so one
   copy stays in the tree.
3. Adapt the call sites. Error classes, streaming helpers and usage/thinking
   token fields are the likely seams: the planner's cost report (pl-49, pl-52)
   reads the usage fields, so a renamed field shows up as a wrong cost, not a
   type error, if a fixture hides it.
4. Run `npm test -- --project planner` and `--project ledger`. The suites run
   on fixtures; say in the Log whether any fixture had to change shape, because
   a fixture rewritten to fit the new SDK proves less than one that already fit.

## Done when

- The three workspaces resolve one `@anthropic-ai/sdk` 1.x, and `npm run check`
  and both tools' suites pass.
- The Log lists each breaking change the migration notes name and what this
  tree did about it (including "not called here").

## Log

- 2026-10-24: filed from the dependency audit; 0.125.0 → 1.3.0 was the gap.
- 2026-11-01 (builder): moved `@anthropic-ai/sdk` from `^0.125.0` to `^1.3.0`. The
  brief said three workspaces import it; the declarations are in `@planner/agent`
  (`src/providers/anthropic.ts`), `@ledger/receipts` (`reader.ts`, `layout.ts`,
  `failure.ts`) and `@planner/api`, where the SDK is a `devDependency` used only by
  `test/live/run.ts` (no `src` import). All three ranges moved together.
  - **Seven-day rule.** `npm view @anthropic-ai/sdk time`: 1.0.0 2026-10-21, 1.1.0
    2026-10-21, 1.2.0 2026-10-23, 1.3.0 2026-10-23T23:31Z (9 days old on 2026-11-01).
    The lockfile gained one new transitive entry, `@opentelemetry/api` 1.10.0
    (2026-10-20, 12 days); `standardwebhooks` 1.1.1 and `json-schema-to-ts` 3.1.1 did
    not move. Done with `npx -y npm@11.21.1 update @anthropic-ai/sdk --before=2026-10-25
    --ignore-scripts`, then `npm install --ignore-scripts` on npm 10 to drop npm 11's
    `peer` markers: the lockfile diff is the SDK entry, the new `@opentelemetry/api`
    entry and the three workspace ranges. `node scripts/check-lockfile-sync.mjs` clean;
    `npm audit --package-lock-only` names neither package (its other findings are
    `glob`/`archiver`, already there). The SDK's license field is now `Apache-2.0`
    (was MIT); the migration notes say so ("The license is Apache 2.0").
  - **Breaking changes the migration notes name**
    (`platform.claude.com/docs/en/api/migration-2026-10-21`, plus the SDK CHANGELOG
    0.126.0 to 1.3.0, whose only `BREAKING CHANGES` entry is "add support for new API
    version 2026-10-21"):
    - _API keys are sent as `Authorization: Bearer`_ instead of `X-Api-Key`; "the
      Claude API accepts a key in either header". **Called here, and it broke two
      assertions in each tool**: the planner's `anthropic-provider.test.ts` and the
      ledger's `reader.test.ts` asserted `x-api-key`. They now assert
      `authorization: Bearer <key>` and no `x-api-key`. Not measured against the live
      API (no live call in this ticket): the claim that Bearer works rests on the
      migration notes.
    - _`anthropic-version` is `2026-10-21`_: asserted in both tools' tests now.
    - _A client holds one credential_ (two of `apiKey`, `authToken`, ... throw a
      `TypeError`; `null` does not count). Called here: both constructors pass
      `apiKey`, `authToken: null`, `webhookKey: null`, which is allowed. Because the
      key and a token now share `Authorization`, the planner test stubs
      `ANTHROPIC_AUTH_TOKEN` (the ledger's already did) so the stray-token guard is
      still exercised; neither test was shown to fail with the guard removed.
    - _`ANTHROPIC_CUSTOM_HEADERS`_: unchanged mechanism (`defaultHeaders` win over
      the key), but the header it would overwrite is now `Authorization`; the
      comment in `anthropic.ts` says so. Both `api` configs still refuse to boot with
      it set.
    - _Sampling parameters removed (`temperature`, `top_p`, `top_k` return 400)_: not
      called here (`grep` over `agent/src`, `receipts/src`, `api/test/live` finds none).
    - _Document blocks in assistant messages; `citations` on user text blocks_: not
      sent here.
    - _`MessageParam` is a union by role_: type-level only; `npm run check` finds
      nothing to change.
    - _Client-side compaction (`compactionControl`) removed from the tool runner_,
      _Text Completions removed_, _`betas` removed from non-beta Models methods_,
      _one-value enums as constants_ (other SDKs): not called here.
    - _Admin API / Enterprise Analytics field renames_: not called here.
    - From the changelog rather than the notes: 1.3.0 "read the beta route qualifier
      instead of the beta=true query": **called here**; `beta.messages.create` no
      longer puts `?beta=true` on the URL (the planner test asserted it, now
      asserts the bare `/v1/messages`; the `anthropic-beta` header test beside it is
      unchanged and passes). 0.126.0 "mark usage iteration model as nullable":
      `usageOf` does not read `iterations[].model`. 0.129.0/0.134.0 stream and
      fallback fixes: this tree does not stream.
  - **Usage fields.** The brief's worry (a renamed field showing as a wrong cost).
    `usageOf` reads `input_tokens`, `output_tokens`, the cache fields,
    `iterations` and `output_tokens_details.thinking_tokens`; grep of
    `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts` shows
    `output_tokens_details` still on `BetaUsage` (line 6228) and
    `BetaMessageDeltaUsage` only, so the comment's "absent from every iteration type"
    still holds at 1.3.0. The existing `anthropic-provider.test.ts` usage cases pass
    unchanged.
  - **Fixtures.** No fixture file changed shape (`anthropic-messages.json` is
    untouched; its header still cites 0.125.0 typings as where it was hand-written
    from). The changed assertions are about the request the SDK builds, not the
    responses it parses, so no fixture was rewritten to fit.
  - **Checks.** `npm run check` exit 0; `npx vitest run tools/planner/agent
    tools/ledger/receipts`: 194 of 194; `npm test -- --project planner`: 1940 of 1940;
    `npm test -- --project ledger`: 2037 of 2037. Unmeasured: any live call (so
    Bearer-with-a-real-key, and the model reads' behaviour under API version
    2026-10-21, are unproven here; the migration notes list nothing in the Messages
    request this tree sends).
  - **Fold-in.** None made: nothing else small and already specified came free.
    `npm install --ignore-scripts` on the farm dropped `better-sqlite3`'s `build/`;
    restored by copying it from the shared checkout (worktree-local, not committed).
