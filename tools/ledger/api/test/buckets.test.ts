/**
 * `GET /api/buckets` (lg-5): a synthetic paste, classified by rules, read back
 * as each person's own money in the mortgage bucket and the buffer's balance.
 * Every description and amount is invented.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type { BucketsResponse, ErrorResponse, RuleDraft } from "@ledger/contract";
import type { App } from "../src/server.ts";
import { addRule, pasteStatement, rowId, startApp } from "./helpers/classification.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import type { PasteRow } from "./helpers/paste.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

const SAM_MORTGAGE = "Virement entre folios /Caisse du Lac";
const ALEX_MORTGAGE = "Virement entre folios /Caisse du Mont";
const SAM_BUFFER = "Virement - AccèsD Internet /Caisse du Lac";
const PAYMENT = "Hypothèque /Prêteur Exemple";
const TAXES = "Taxes /Ville Exemple";
const GROCERIES = "Achat /Marché Exemple";

/** Oldest first. The payment is an odd number of cents; the groceries match no rule. */
const ROWS: PasteRow[] = [
  { date: "2026-09-02", description: SAM_MORTGAGE, amountCents: 40000 },
  { date: "2026-09-05", description: ALEX_MORTGAGE, amountCents: 50000 },
  {
    date: "2026-09-12",
    category: "Loyer/Prêt hypothécaire",
    description: PAYMENT,
    amountCents: -70001,
  },
  { date: "2026-09-15", description: SAM_BUFFER, amountCents: 30000 },
  { date: "2026-09-20", category: "Taxes", description: TAXES, amountCents: -12000 },
  { date: "2026-09-25", category: "Épicerie", description: GROCERIES, amountCents: -1000 },
  { date: "2026-10-01", category: "Taxes", description: TAXES, amountCents: -5000 },
];

function rule(
  descriptionPattern: string,
  personId: string | null,
  bucket: RuleDraft["bucket"],
): RuleDraft {
  return {
    descriptionPattern,
    category: null,
    amountCents: null,
    personId,
    bucket,
    spendingCategoryId: null,
  };
}

async function start(): Promise<App> {
  app = await startApp();
  await addRule(app, rule(SAM_MORTGAGE, "sam", "mortgage"));
  await addRule(app, rule(ALEX_MORTGAGE, "alex", "mortgage"));
  await addRule(app, rule(PAYMENT, null, "mortgage"));
  await addRule(app, rule(SAM_BUFFER, "sam", "current-expenses"));
  await addRule(app, rule(TAXES, null, "current-expenses"));
  // The account held money before the first pasted row; no bucket claims it.
  await pasteStatement(app, renderPaste(withBalances(ROWS, 150000)));
  return app;
}

async function buckets(target: App, query = ""): Promise<BucketsResponse> {
  const response = await target.server.inject({ method: "GET", url: `${ROUTES.buckets}${query}` });
  expect(response.statusCode).toBe(200);
  return response.json<BucketsResponse>();
}

/** Every cent of the mortgage bucket that is someone's. */
function attributed(mortgage: BucketsResponse["mortgage"]): number {
  return mortgage.own.reduce((sum, person) => sum + person.ownCents, 0);
}

describe("GET /api/buckets", () => {
  test("each person's own money in the mortgage bucket sums to its balance, odd cent and all", async () => {
    const target = await start();

    const { mortgage } = await buckets(target, "?asOf=2026-09-30");

    expect(mortgage.balanceCents).toBe(40000 + 50000 - 70001);
    // alex sorts first, and so bears the payment's odd cent.
    expect(mortgage.own).toEqual([
      { personId: "alex", ownCents: 50000 - 35001 },
      { personId: "sam", ownCents: 40000 - 35000 },
    ]);
    expect(attributed(mortgage)).toBe(mortgage.balanceCents);
    expect(mortgage.lead).toEqual({ personId: "alex", byCents: 14999 - 5000 });
  });

  test("the buffer's balance as of a past date leaves out the later row", async () => {
    const target = await start();

    const past = await buckets(target, "?asOf=2026-09-30");
    const today = await buckets(target);

    expect(past.buffer).toEqual({
      balanceCents: 30000 - 12000,
      contributions: [
        { personId: "alex", contributedCents: 0 },
        { personId: "sam", contributedCents: 30000 },
      ],
    });
    // The helper's clock reads 2026-10-03, after the taxes of 2026-10-01.
    expect(today.asOf).toBe("2026-10-03");
    expect(today.buffer.balanceCents).toBe(30000 - 12000 - 5000);
  });

  test("counts the rows nobody has classified, which neither bucket includes", async () => {
    const target = await start();

    expect((await buckets(target, "?asOf=2026-09-20")).unclassified).toBe(0);
    expect((await buckets(target)).unclassified).toBe(1);
  });

  test("a reclassified row moves to its new bucket for every date", async () => {
    const target = await start();
    const taxes = rowId(target, TAXES, -12000);

    const moved = await target.server.inject({
      method: "POST",
      url: ROUTES.classifications,
      payload: { rowId: taxes, personId: null, bucket: "mortgage" },
    });
    expect(moved.statusCode).toBe(200);

    const after = await buckets(target, "?asOf=2026-09-30");
    expect(after.buffer.balanceCents).toBe(30000);
    expect(after.mortgage.balanceCents).toBe(40000 + 50000 - 70001 - 12000);
    expect(attributed(after.mortgage)).toBe(after.mortgage.balanceCents);
  });

  test("an empty history is two empty buckets", async () => {
    app = await startApp();

    expect(await buckets(app)).toEqual({
      asOf: "2026-10-03",
      mortgage: {
        balanceCents: 0,
        own: [
          { personId: "alex", ownCents: 0 },
          { personId: "sam", ownCents: 0 },
        ],
        lead: null,
      },
      buffer: {
        balanceCents: 0,
        contributions: [
          { personId: "alex", contributedCents: 0 },
          { personId: "sam", contributedCents: 0 },
        ],
      },
      unclassified: 0,
    });
  });

  test("a date that is not a day is refused", async () => {
    app = await startApp();

    for (const query of ["?asOf=2026-02-30", "?asOf=yesterday", "?other=1"]) {
      const response = await app.server.inject({ method: "GET", url: `${ROUTES.buckets}${query}` });
      expect(response.statusCode, query).toBe(400);
      expect(response.json<ErrorResponse>().error.code).toBe("BAD_REQUEST");
    }
  });
});
