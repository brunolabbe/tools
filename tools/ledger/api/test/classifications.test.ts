/**
 * Classifying on paste, the inbox, and classifying again (lg-4).
 *
 * The ticket's four promises are the four describes: an exact match is
 * classified on paste and a near one is a question; two rules matching one row
 * send it to the inbox; and reclassifying keeps the earlier answer as history.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type { ClassificationRecord, ErrorResponse, InboxRow, RuleDraft } from "@ledger/contract";
import type { App } from "../src/server.ts";
import { SAM } from "./helpers/access.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
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

// Level at the top of the ranking, with different answers (lg-16 changed lg-4's
// "two rules match" to this: a narrower rule now takes a row from a broader one).
describe("two rules level at the top with different answers", () => {
  const OTHER_ANSWER = { ...MORTGAGE_RULE, bucket: "current-expenses" } as const;

  test("send the row to the inbox, never to the first rule", async () => {
    const target = await start();
    const first = await addRule(target, MORTGAGE_RULE);
    const second = await addRule(target, OTHER_ANSWER);

    await pasteStatement(target);

    const [row] = byDescription(await readInbox(target), MORTGAGE);
    expect(row).toMatchObject({ reason: "ambiguous" });
    expect(row?.matching.map((rule) => rule.id)).toEqual([first.id, second.id]);
    expect(classifications(target)).toEqual([]);
  });

  test("the order the rules were added in changes nothing", async () => {
    const target = await start();
    await addRule(target, OTHER_ANSWER);
    await addRule(target, MORTGAGE_RULE);

    await pasteStatement(target);

    expect(classifications(target)).toEqual([]);
    expect(byDescription(await readInbox(target), MORTGAGE)[0]?.reason).toBe("ambiguous");
  });

  test("with the same answer the row is classified, by the newest of them", async () => {
    const target = await start();
    await addRule(target, MORTGAGE_RULE);
    const newer = await addRule(target, { ...MORTGAGE_RULE, descriptionPattern: "HYPOTHÈQUE*" });

    await pasteStatement(target);

    expect(classifications(target)).toEqual([
      expect.objectContaining({ row_id: rowId(target, MORTGAGE, -70000), rule_id: newer.id }),
    ]);
  });
});

describe("the most specific rule takes a row (lg-16)", () => {
  // The caisse names the person, so the broad rule is the household's own and the
  // narrow one is the person's fixed amount.
  const BROAD: RuleDraft = {
    descriptionPattern: "Virement entre folios*",
    category: null,
    amountCents: null,
    personId: null,
    bucket: "current-expenses",
  };

  test("a narrower fixed-amount rule takes its row from a broad one, in either order", async () => {
    for (const narrowFirst of [false, true]) {
      const target = await start();
      const ids = { broad: 0, narrow: 0 };
      if (narrowFirst) ids.narrow = (await addRule(target, TRANSFER_RULE)).id;
      ids.broad = (await addRule(target, BROAD)).id;
      if (!narrowFirst) ids.narrow = (await addRule(target, TRANSFER_RULE)).id;

      await pasteStatement(target);

      expect(classifications(target)).toEqual([
        expect.objectContaining({
          row_id: rowId(target, TRANSFER, 40000),
          rule_id: ids.narrow,
          person_id: "sam",
        }),
      ]);
      await target.shutdown();
      app = undefined;
    }
  });

  test("an unusual amount is a question, though the broad rule matches it exactly", async () => {
    const target = await start();
    const broad = await addRule(target, BROAD);
    const narrow = await addRule(target, TRANSFER_RULE);

    await pasteStatement(target);

    const [odd] = byDescription(await readInbox(target), TRANSFER);
    expect(odd).toMatchObject({
      amountCents: 45000,
      reason: "differs",
      suggestion: { id: narrow.id },
    });
    expect(odd?.matching.map((rule) => rule.id)).toEqual([broad.id]);
    expect(classifications(target).map((c) => c.row_id)).not.toContain(odd?.id);
  });
});

async function answer(
  target: App,
  id: number,
  body: { personId: string | null; bucket: string } | { ruleId: number },
): Promise<void> {
  const response = await target.server.inject({
    method: "POST",
    url: ROUTES.classifications,
    payload: { rowId: id, ...body },
  });
  expect(response.statusCode, response.body).toBe(200);
}

describe("the inbox carries what a person answered before (lg-16)", () => {
  test("a description answered by a person carries that answer, and one never answered none", async () => {
    const target = await start();
    await pasteStatement(target);
    await answer(target, rowId(target, TRANSFER, 40000), { personId: "sam", bucket: "mortgage" });

    const inbox = await readInbox(target);

    expect(byDescription(inbox, TRANSFER)[0]?.history).toEqual({
      personId: "sam",
      bucket: "mortgage",
      times: 1,
    });
    expect(byDescription(inbox, GROCERIES)[0]?.history).toBeNull();
  });

  test("a description a rule answered carries none, so a rule is not mistaken for a person", async () => {
    const target = await start();
    await addRule(target, TRANSFER_RULE);

    await pasteStatement(target);

    const [odd] = byDescription(await readInbox(target), TRANSFER);
    // The usual amount was filed by the rule; the unusual one has no person's answer to go on.
    expect(classifications(target)).toEqual([expect.objectContaining({ source: "rule" })]);
    expect(odd).toMatchObject({ reason: "differs", history: null });
  });

  test("an accepted rule is a person's answer too", async () => {
    const target = await start();
    // Stored before the rule exists, so it waits and the rule is a suggestion for it.
    await pasteStatement(target, paste(0, 1));
    const rule = await addRule(target, TRANSFER_RULE);
    await answer(target, rowId(target, TRANSFER, 40000), { ruleId: rule.id });
    await pasteStatement(target);

    expect(classifications(target)[0]).toMatchObject({ source: "accepted" });
    expect(byDescription(await readInbox(target), TRANSFER)[0]?.history).toEqual({
      personId: "sam",
      bucket: "mortgage",
      times: 1,
    });
  });

  test("a row a rule filed and a person corrected counts as the person's answer", async () => {
    const target = await start();
    await addRule(target, TRANSFER_RULE);
    await pasteStatement(target);
    await answer(target, rowId(target, TRANSFER, 40000), {
      personId: null,
      bucket: "current-expenses",
    });

    expect(byDescription(await readInbox(target), TRANSFER)[0]?.history).toEqual({
      personId: null,
      bucket: "current-expenses",
      times: 1,
    });
  });

  test("the latest answer stands and the count is of those that agree with it", async () => {
    const target = await start();
    // Four rows with one description, so three can be answered and one left waiting.
    const same = [1, 2, 3, 4].map((day) => ({
      date: `2026-09-0${String(day)}`,
      category: "Épicerie",
      description: GROCERIES,
      amountCents: -1000 * day,
    }));
    await pasteStatement(target, renderPaste(withBalances(same, 150000)));
    const [a, b, c] = [1000, 2000, 3000].map((cents) => rowId(target, GROCERIES, -cents));
    await answer(target, a ?? 0, { personId: "sam", bucket: "mortgage" });
    await answer(target, b ?? 0, { personId: "alex", bucket: "current-expenses" });
    await answer(target, c ?? 0, { personId: "alex", bucket: "current-expenses" });

    // The earliest answer differs and the two latest agree: "the last 2 times".
    const [waiting] = await readInbox(target);
    expect(waiting).toMatchObject({
      amountCents: -4000,
      history: { personId: "alex", bucket: "current-expenses", times: 2 },
    });
  });

  test("taking it is an ordinary manual answer, by whoever tapped", async () => {
    const target = await start(SAM);
    await pasteStatement(target);
    await answer(target, rowId(target, TRANSFER, 40000), { personId: "alex", bucket: "mortgage" });
    const [odd] = byDescription(await readInbox(target), TRANSFER);

    await answer(target, odd?.id ?? 0, {
      personId: odd?.history?.personId ?? null,
      bucket: odd?.history?.bucket ?? "mortgage",
    });

    expect(classifications(target).at(-1)).toMatchObject({
      row_id: odd?.id,
      source: "manual",
      rule_id: null,
      person_id: "alex",
      bucket: "mortgage",
      classified_by: "sam",
    });
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
