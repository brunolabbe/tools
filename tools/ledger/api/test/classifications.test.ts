/**
 * Classifying on paste, the inbox, and classifying again (lg-4).
 *
 * The ticket's four promises are the four describes: an exact match is
 * classified on paste and a near one is a question; two rules matching one row
 * send it to the inbox; and reclassifying keeps the earlier answer as history.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type { ClassificationRecord, ErrorResponse, InboxRow } from "@ledger/contract";
import type { App } from "../src/server.ts";
import { SAM } from "./helpers/access.ts";
import {
  GROCERIES,
  HISTORY,
  MORTGAGE,
  MORTGAGE_RULE,
  TRANSFER,
  TRANSFER_RULE,
  addRule,
  classifications,
  paste,
  pasteStatement,
  readInbox,
  rowId,
  startApp,
} from "./helpers/classification.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

async function start(...args: Parameters<typeof startApp>): Promise<App> {
  app = await startApp(...args);
  return app;
}

function byDescription(rows: InboxRow[], description: string): InboxRow[] {
  return rows.filter((row) => row.description === description);
}

describe("classifying on paste", () => {
  test("a row matching one rule exactly is classified, and the rest are the inbox", async () => {
    const target = await start();
    const rule = await addRule(target, TRANSFER_RULE);
    const mortgage = await addRule(target, MORTGAGE_RULE);

    await pasteStatement(target);

    const stored = classifications(target);
    expect(stored).toHaveLength(2);
    expect(stored).toContainEqual(
      expect.objectContaining({
        row_id: rowId(target, TRANSFER, 40000),
        rule_id: rule.id,
        source: "rule",
        bucket: "mortgage",
        person_id: "sam",
        // Who pasted, and when the app's clock said.
        classified_by: "alex",
        classified_at: "2026-10-03T09:30:00.000Z",
      }),
    );
    // A rule with no person files a row as joint.
    expect(stored).toContainEqual(
      expect.objectContaining({ rule_id: mortgage.id, person_id: null, source: "rule" }),
    );
    const inbox = await readInbox(target);
    expect(inbox.map((row) => row.description).toSorted()).toEqual([GROCERIES, TRANSFER]);
  });

  test("a transfer that is not its usual amount lands in the inbox with that rule suggested", async () => {
    const target = await start();
    const rule = await addRule(target, TRANSFER_RULE);

    await pasteStatement(target);

    const [odd] = byDescription(await readInbox(target), TRANSFER);
    expect(odd).toMatchObject({
      amountCents: 45000,
      reason: "differs",
      suggestion: { id: rule.id, amountCents: 40000, personId: "sam" },
      matching: [],
    });
    // The row has no classification at all: the inbox is the rows without one.
    expect(classifications(target).map((c) => c.row_id)).not.toContain(odd?.id);
  });

  test("with no rules at all, every row is in the inbox with nothing suggested", async () => {
    const target = await start();

    await pasteStatement(target);

    const inbox = await readInbox(target);
    expect(inbox).toHaveLength(HISTORY.length);
    expect(inbox.every((row) => row.reason === "no-rule" && row.suggestion === null)).toBe(true);
    expect(classifications(target)).toEqual([]);
  });

  test("the inbox is newest first", async () => {
    const target = await start();

    await pasteStatement(target);

    const dates = (await readInbox(target)).map((row) => row.date);
    expect(dates).toEqual(dates.toSorted().toReversed());
  });

  test("only the rows a paste adds are classified, never the ones already stored", async () => {
    const target = await start();
    await pasteStatement(target, paste(0, 2));
    // Added after the first paste: it does not reach back to the rows stored without it.
    const rule = await addRule(target, TRANSFER_RULE);

    await pasteStatement(target, paste(0, 4));

    expect(classifications(target)).toEqual([]);
    const first = byDescription(await readInbox(target), TRANSFER).find(
      (row) => row.amountCents === 40000,
    );
    // It is the inbox's one-tap answer instead: the rule matches this row exactly.
    expect(first).toMatchObject({ reason: "matches", suggestion: { id: rule.id } });
  });

  test("pasting the same text again classifies nothing twice", async () => {
    const target = await start();
    await addRule(target, MORTGAGE_RULE);

    await pasteStatement(target);
    await pasteStatement(target);

    expect(classifications(target)).toHaveLength(1);
  });

  test("a rule that was retired before the paste is not applied", async () => {
    const target = await start();
    const rule = await addRule(target, MORTGAGE_RULE);
    await target.server.inject({ method: "POST", url: `${ROUTES.rules}/${rule.id}/retire` });

    await pasteStatement(target);

    expect(classifications(target)).toEqual([]);
  });

  test("a paste is stored with its classifications or not at all", async () => {
    const target = await start();
    await addRule(target, MORTGAGE_RULE);
    // A classification that cannot be written, as a full disk or a locked file would be.
    target.context.db.exec(
      "CREATE TRIGGER refuse BEFORE INSERT ON classifications BEGIN SELECT RAISE(ABORT, 'refused'); END",
    );

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.statements,
      payload: { text: paste() },
    });

    expect(response.statusCode).toBe(500);
    // Nothing of the paste stayed: not its rows, and not the import they came from.
    expect(target.context.db.prepare("SELECT count(*) AS n FROM statement_rows").get()).toEqual({
      n: 0,
    });
    expect(target.context.db.prepare("SELECT count(*) AS n FROM statement_imports").get()).toEqual({
      n: 0,
    });
  });
});

describe("two rules matching one row", () => {
  test("send it to the inbox, never to the first rule", async () => {
    const target = await start();
    const first = await addRule(target, MORTGAGE_RULE);
    const second = await addRule(target, { ...MORTGAGE_RULE, descriptionPattern: "*Prêteur*" });

    await pasteStatement(target);

    const [row] = byDescription(await readInbox(target), MORTGAGE);
    expect(row).toMatchObject({ reason: "ambiguous" });
    expect(row?.matching.map((rule) => rule.id)).toEqual([first.id, second.id]);
    expect(classifications(target)).toEqual([]);
  });

  test("the order the rules were added in changes nothing", async () => {
    const target = await start();
    await addRule(target, { ...MORTGAGE_RULE, descriptionPattern: "*Prêteur*" });
    await addRule(target, MORTGAGE_RULE);

    await pasteStatement(target);

    expect(classifications(target)).toEqual([]);
    expect(byDescription(await readInbox(target), MORTGAGE)[0]?.reason).toBe("ambiguous");
  });
});

describe("classifying a row again", () => {
  test("keeps the earlier classification, with who changed it and when", async () => {
    const target = await start();
    await addRule(target, MORTGAGE_RULE);
    await pasteStatement(target);
    const mortgageRow = rowId(target, MORTGAGE, -70000);

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.classifications,
      payload: { rowId: mortgageRow, personId: "sam", bucket: "current-expenses" },
    });

    expect(response.statusCode, response.body).toBe(200);
    const stored = classifications(target);
    expect(stored).toHaveLength(2);
    // The first is exactly what the paste wrote, untouched.
    expect(stored[0]).toMatchObject({
      row_id: mortgageRow,
      source: "rule",
      bucket: "mortgage",
      person_id: null,
    });
    expect(stored[1]).toMatchObject({
      row_id: mortgageRow,
      source: "manual",
      rule_id: null,
      bucket: "current-expenses",
      person_id: "sam",
    });
    // And the answer that stands is the later one.
    const standing = target.context.db
      .prepare("SELECT bucket, person_id FROM current_classifications WHERE row_id = ?")
      .all(mortgageRow);
    expect(standing).toEqual([{ bucket: "current-expenses", person_id: "sam" }]);
  });

  test("records who answered, from the identity and not from the body", async () => {
    const target = await start(SAM);
    await pasteStatement(target);
    const [grocery] = byDescription(await readInbox(target), GROCERIES);

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.classifications,
      payload: { rowId: grocery?.id, personId: null, bucket: "current-expenses" },
    });

    const record = response.json<ClassificationRecord>();
    expect(record).toMatchObject({ classifiedBy: "sam", personId: null, source: "manual" });
    expect(await readInbox(target)).not.toContainEqual(
      expect.objectContaining({ id: grocery?.id }),
    );
  });

  test("accepting a suggested rule takes its person and bucket, and leaves the inbox", async () => {
    const target = await start();
    const rule = await addRule(target, TRANSFER_RULE);
    await pasteStatement(target);
    const [odd] = byDescription(await readInbox(target), TRANSFER);

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.classifications,
      payload: { rowId: odd?.id, ruleId: odd?.suggestion?.id },
    });

    expect(response.json<ClassificationRecord>()).toMatchObject({
      rowId: odd?.id,
      ruleId: rule.id,
      personId: "sam",
      bucket: "mortgage",
      source: "accepted",
    });
    expect(byDescription(await readInbox(target), TRANSFER)).toEqual([]);
  });

  test("a rule that is no longer in force cannot be accepted", async () => {
    const target = await start();
    const rule = await addRule(target, TRANSFER_RULE);
    await pasteStatement(target);
    const [odd] = byDescription(await readInbox(target), TRANSFER);
    await target.server.inject({ method: "POST", url: `${ROUTES.rules}/${rule.id}/retire` });

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.classifications,
      payload: { rowId: odd?.id, ruleId: rule.id },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorResponse>().error.code).toBe("RULE_NOT_FOUND");
    // Only the paste's own classification, of the row that did match.
    expect(classifications(target)).toHaveLength(1);
  });

  test("a row that is not stored is refused by name", async () => {
    const target = await start();

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.classifications,
      payload: { rowId: 999, personId: null, bucket: "mortgage" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorResponse>().error.code).toBe("ROW_NOT_FOUND");
  });

  test.each([
    ["a person nobody has heard of", { personId: "mallory", bucket: "mortgage" }],
    ["a bucket that is not one of the two", { personId: "sam", bucket: "savings" }],
    ["no answer at all", {}],
    ["a rule and a bucket together", { ruleId: 1, personId: "sam", bucket: "mortgage" }],
    ["a person without a bucket", { personId: "sam" }],
  ])("%s is a bad request and stores nothing", async (_name, answer) => {
    const target = await start();
    await pasteStatement(target);
    const [row] = await readInbox(target);

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.classifications,
      payload: { rowId: row?.id, ...answer },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorResponse>().error.code).toBe("BAD_REQUEST");
    expect(classifications(target)).toEqual([]);
  });
});
