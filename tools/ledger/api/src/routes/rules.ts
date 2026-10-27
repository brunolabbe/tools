/**
 * The rules and the people they may name (lg-4; the people from lg-5's table,
 * and how each is shown from the household directory, lg-33).
 *
 * Every route is behind the identity check, and records who acted from
 * `personOf` — never from anything the body says. **Every write is a `POST`
 * because every write appends**: editing a rule files a new version, retiring
 * one files a retirement, and nothing is updated or deleted
 * (`docs/00-ANALYSIS.md` §9).
 *
 * A rule's pattern, category and amount are bank text, so a refusal says which
 * field was wrong and never repeats the value (`CLAUDE.md`).
 */

import { AppError, GENERATED_ID, ROUTES, ruleDraftSchema } from "@ledger/contract";
import type { PeopleResponse, Rule, RuleDraft, RulesResponse } from "@ledger/contract";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";
import { byShownName, shownName } from "../directory.ts";
import { booksOf, personOf } from "../identity.ts";
import { knownPeople, peopleInOpenPeriod } from "../people.ts";
import { rateLimitsFor } from "../rate-limit.ts";
import { createRule, currentRules, editRule, retireRule } from "../rules.ts";
import type { RuleContext } from "../rules.ts";

export function ruleContext(context: AppContext, request: FastifyRequest): RuleContext {
  return {
    db: booksOf(request),
    personId: personOf(request).id,
    now: context.now,
    people: new Set(knownPeople(booksOf(request))),
  };
}

function ruleId(request: FastifyRequest): number {
  const raw = (request.params as { id?: unknown }).id;
  const id = typeof raw === "string" && /^\d{1,15}$/u.test(raw) ? Number(raw) : 0;
  if (id < 1) throw new AppError("BAD_REQUEST", "A rule is named by its number.");
  return id;
}

/**
 * How each of `people` is shown, with no two alike (lg-33's gate 1, F3; option
 * 2, chosen by the owner on 2026-10-18). The directory refuses a shown name
 * another person holds or has as an id, but it cannot see an id the books hold
 * only from an old rule, so a rename can take one, and so can a person added
 * under that name since lg-76. Here, with the books, every person whose shown
 * name another shares is shown under their id instead, or, when their id is a
 * generated one that is never shown (lg-76), under the name with the lowest
 * free " 2", " 3" … after it. Ids are unique and every suffix is taken free, so
 * the loop ends; it runs again in case a fallback meets a name still standing.
 */
function distinctNames(
  people: readonly string[],
  names: ReadonlyMap<string, string>,
): Record<string, string> {
  const shown = new Map(people.map((person) => [person, shownName(names, person)]));
  for (;;) {
    const count = new Map<string, number>();
    for (const name of shown.values()) count.set(name, (count.get(name) ?? 0) + 1);
    const alike = [...shown].filter(
      ([person, name]) => name !== person && (count.get(name) ?? 0) > 1,
    );
    if (alike.length === 0) break;
    for (const [person, name] of alike) {
      if (!GENERATED_ID.test(person)) {
        shown.set(person, person);
        continue;
      }
      const taken = new Set([...shown.values(), ...people]);
      let n = 2;
      while (taken.has(`${name} ${String(n)}`)) n++;
      shown.set(person, `${name} ${String(n)}`);
    }
  }
  return Object.fromEntries(shown);
}

function draft(request: FastifyRequest): RuleDraft {
  const body = ruleDraftSchema.safeParse(request.body);
  if (!body.success) {
    // The issues name a field, never a value: a pattern is bank text.
    const fields = [...new Set(body.error.issues.map((issue) => String(issue.path[0] ?? "body")))];
    throw new AppError("BAD_REQUEST", `The rule is not valid: check ${fields.join(", ")}.`);
  }
  return body.data;
}

export function registerRuleRoutes(app: FastifyInstance, context: AppContext): void {
  const { read, write } = rateLimitsFor(context);

  app.get(ROUTES.rules, { onRequest: read }, async (request) => {
    const body: RulesResponse = { rules: currentRules(booksOf(request)) };
    return body;
  });

  // CodeQL's `js/missing-rate-limiting` models express-rate-limit and its kin,
  // not `@webtools/core`'s `RateLimiter`, so it reads the `read` hook on this
  // route as no limit at all; the route is limited per person like every other
  // (`rate-limit.ts`). Excused under `docs/adr/005`, here in
  // `api/src/routes/rules.ts`. Guarded by `api/test/route-limits.test.ts`:
  // taking `{ onRequest: read }` off this route fails 1 of its 40 tests, "people
  // refuses the second request in a minute, as RATE_LIMITED" — that test, not
  // this comment, is what holds it. Measured 2026-10-10 on lg-15, base ad51f0b8.
  // codeql[js/missing-rate-limiting]
  app.get(ROUTES.people, { onRequest: read }, async (request) => {
    // The household's table, which the directory's members fill (people.ts),
    // split into who is in from the open period on and who has been retired
    // (lg-35), and how each is shown, which only the directory knows (lg-33).
    // Each list in the order a person reads it, by shown name (lg-76): an id
    // may be a UUID, whose order means nothing.
    const { people, retired } = peopleInOpenPeriod(booksOf(request));
    const names = distinctNames(
      [...people, ...retired].toSorted(),
      context.directory.names(personOf(request).household),
    );
    const order = byShownName(new Map(Object.entries(names)));
    const body: PeopleResponse = {
      people: people.toSorted(order),
      retired: retired.toSorted(order),
      names,
    };
    return body;
  });

  app.post(ROUTES.rules, { onRequest: write }, async (request) => {
    const rule: Rule = createRule(ruleContext(context, request), draft(request));
    return rule;
  });

  // The rule as edited, under a new id: the version it replaces is not changed.
  app.post(ROUTES.rule, { onRequest: write }, async (request) => {
    const rule: Rule = editRule(ruleContext(context, request), ruleId(request), draft(request));
    return rule;
  });

  // The rule as it stood. Rows it classified keep their records.
  app.post(ROUTES.ruleRetire, { onRequest: write }, async (request) => {
    const rule: Rule = retireRule(ruleContext(context, request), ruleId(request));
    return rule;
  });
}
