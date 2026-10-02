import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type { ErrorResponse, ImportStatementReport } from "@ledger/contract";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { ALEX, SAM, accessConfig } from "./helpers/access.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import type { PasteRow } from "./helpers/paste.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

/** Whoever the development identity names is the caller; no token is needed. */
async function startApp(person: string = ALEX): Promise<App> {
  app = await createApp({
    config: {
      databasePath: ":memory:",
      logLevel: "silent",
      access: accessConfig({ devIdentity: person }),
    },
    now: () => new Date("2026-10-02T09:30:00Z"),
  });
  return app;
}

/**
 * Ten rows across a month boundary, oldest first, all invented. Rows 5 and 6 are
 * the ones the gap tests leave out, and every amount is distinct so an
 * unexplained figure is the sum of exactly the rows that went missing.
 */
const HISTORY: PasteRow[] = [
  { date: "2026-09-02", description: "Virement entre folios /Caisse du Lac", amountCents: 40000 },
  {
    date: "2026-09-05",
    category: "Assurances",
    description: "Assurance habitation /Assureur Exemple",
    amountCents: -8999,
  },
  {
    date: "2026-09-12",
    category: "Loyer/Prêt hypothécaire",
    description: "Hypothèque /Prêteur Exemple",
    amountCents: -70000,
  },
  {
    date: "2026-09-12",
    description: "Virement - AccèsD Internet /Caisse du Lac",
    amountCents: 35050,
  },
  {
    date: "2026-09-26",
    category: "Frais de service",
    description: "Frais mensuels",
    amountCents: -500,
  },
  {
    date: "2026-09-28",
    category: "Taxes municipales/scolaires",
    description: "Taxes /Ville Exemple",
    amountCents: -110000,
  },
  { date: "2026-10-01", description: "Virement entre folios /Caisse du Lac", amountCents: 40000 },
  {
    date: "2026-10-01",
    category: "Frais de service",
    description: "Frais mensuels",
    amountCents: -500,
  },
  {
    date: "2026-10-01",
    category: "Épicerie",
    description: "Achat /Marché Exemple",
    amountCents: -12345,
  },
  {
    date: "2026-10-02",
    description: "Virement - AccèsD Internet /Caisse du Lac",
    amountCents: 35050,
  },
];
const OPENING = 150000;
const ROWS = withBalances(HISTORY, OPENING);

/** The paste of rows `from` up to but not including `to`, as AccèsD would list them. */
function paste(from: number, to: number): string {
  return renderPaste(ROWS.slice(from, to));
}

async function post(target: App, text: string) {
  return await target.server.inject({
    method: "POST",
    url: ROUTES.statements,
    payload: { text },
  });
}

async function report(target: App, text: string): Promise<ImportStatementReport> {
  const response = await post(target, text);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<ImportStatementReport>();
}

interface StoredRowColumns {
  seq: number;
  date: string;
  category: string;
  description: string;
  amount_cents: number;
  balance_cents: number;
  import_id: number;
}

function stored(target: App): StoredRowColumns[] {
  return target.context.db
    .prepare(
      "SELECT seq, date, category, description, amount_cents, balance_cents, import_id FROM statement_rows ORDER BY seq",
    )
    .all() as StoredRowColumns[];
}

function refusal(response: { statusCode: number; json: <T>() => T }): ErrorResponse["error"] {
  return response.json<ErrorResponse>().error;
}

describe("POST /api/statements", () => {
  test("the first paste into an empty database is the anchor", async () => {
    const { server, context } = await startApp();

    const response = await server.inject({
      method: "POST",
      url: ROUTES.statements,
      payload: { text: paste(0, 6) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ImportStatementReport>()).toEqual({
      rowsAdded: 6,
      rowsAlreadyPresent: 0,
      tailBalanceCents: ROWS[5]?.balanceCents,
    });
    // Oldest = 0, in the order the account lived, whatever order the paste listed.
    const rows = context.db
      .prepare("SELECT seq, description FROM statement_rows ORDER BY seq")
      .all();
    expect(rows.map((row) => (row as { seq: number }).seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect((rows[0] as { description: string }).description).toBe(HISTORY[0]?.description);
  });

  test("pasting the same text twice adds the rows once", async () => {
    const target = await startApp();
    const text = paste(0, 6);

    const first = await report(target, text);
    const before = stored(target);
    const second = await report(target, text);

    expect(first.rowsAdded).toBe(6);
    expect(second).toEqual({
      rowsAdded: 0,
      rowsAlreadyPresent: 6,
      tailBalanceCents: first.tailBalanceCents,
    });
    expect(stored(target)).toEqual(before);
    // A paste that stored nothing is not an import: there is no row to point at.
    const imports = target.context.db.prepare("SELECT count(*) AS n FROM statement_imports").get();
    expect(imports).toEqual({ n: 1 });
  });

  test("a paste that overlaps the stored tail adds only the new rows, numbered after it", async () => {
    const target = await startApp();
    await report(target, paste(0, 6));

    // Rows 4 and 5 are stored; 6 to 9 are not.
    const second = await report(target, paste(4, 10));

    expect(second).toEqual({
      rowsAdded: 4,
      rowsAlreadyPresent: 2,
      tailBalanceCents: ROWS[9]?.balanceCents,
    });
    const rows = stored(target);
    expect(rows.map((row) => row.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rows.map((row) => row.balance_cents)).toEqual(ROWS.map((row) => row.balanceCents));
    // Each row remembers the import it came from: six by the first, four by the second.
    expect(rows.map((row) => row.import_id)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
  });

  test("a paste that continues exactly where the stored tail ends is accepted", async () => {
    const target = await startApp();
    await report(target, paste(0, 6));

    const second = await report(target, paste(6, 10));

    expect(second).toMatchObject({ rowsAdded: 4, rowsAlreadyPresent: 0 });
    expect(stored(target)).toHaveLength(10);
  });

  test("a paste inside the stored history adds nothing and leaves the tail alone", async () => {
    const target = await startApp();
    await report(target, paste(0, 10));

    const inside = await report(target, paste(2, 5));

    expect(inside).toEqual({
      rowsAdded: 0,
      rowsAlreadyPresent: 3,
      tailBalanceCents: ROWS[9]?.balanceCents,
    });
  });

  test("records who pasted and when, from the identity and the clock", async () => {
    const target = await startApp(SAM);
    await report(target, paste(0, 3));

    const imported = target.context.db
      .prepare("SELECT imported_at, imported_by FROM statement_imports")
      .all();
    // The configured name, never the address.
    expect(imported).toEqual([{ imported_at: "2026-10-02T09:30:00.000Z", imported_by: "sam" }]);
  });

  test("a paste that leaves a gap is refused with the unexplained amount, and stores nothing", async () => {
    const target = await startApp();
    await report(target, paste(0, 6));
    const before = stored(target);

    // Rows 6 and 7 are in neither paste.
    const response = await post(target, paste(8, 10));

    expect(response.statusCode).toBe(422);
    const error = refusal(response);
    expect(error.code).toBe("STATEMENT_CHAIN_BROKEN");
    const missing = (HISTORY[6]?.amountCents ?? 0) + (HISTORY[7]?.amountCents ?? 0);
    expect(error.details).toMatchObject({ unexplainedCents: missing });
    // 400,00 − 5,00 = 395,00, and the message says so in the bank's own terms.
    expect(error.message).toContain("395.00 $ is unexplained");
    expect(stored(target)).toEqual(before);
  });

  test("a gap's unexplained amount is signed: money out reads negative", async () => {
    const target = await startApp();
    await report(target, paste(0, 6));

    // Row 6 alone is missing, and it was a credit of 400,00.
    const response = await post(target, paste(7, 10));

    expect(refusal(response).details).toMatchObject({
      unexplainedCents: HISTORY[6]?.amountCents,
    });
  });

  test("an overlapping row that differs only in its category is refused and named", async () => {
    const target = await startApp();
    await report(target, paste(0, 6));
    const before = stored(target);

    const altered = ROWS.map((row, index) =>
      index === 4 ? { ...row, category: "Divers" } : row,
    ).slice(3, 8);
    const response = await post(target, renderPaste(altered));

    expect(response.statusCode).toBe(422);
    const error = refusal(response);
    expect(error.code).toBe("STATEMENT_ROW_CONFLICT");
    expect(error.details).toMatchObject({
      fields: ["category"],
      stored: { seq: 4, category: "Frais de service", description: "Frais mensuels" },
      pasted: { pasteIndex: 1, category: "Divers", description: "Frais mensuels" },
    });
    expect(error.message).toContain("Frais mensuels");
    expect(error.message).toContain("2026-09-26");
    // Never overwrite: the stored row still says what it said, and the new rows
    // the same paste carried were not stored either.
    expect(stored(target)).toEqual(before);
  });

  test("a pasted row that disagrees about the amount is refused, naming what differs", async () => {
    const target = await startApp();
    await report(target, paste(0, 6));

    // Row 4 is the same row with a different amount, so everything after it
    // moves too; the paste is a valid statement that tells another story.
    const retold = withBalances(
      HISTORY.slice(3, 8).map((row, index) =>
        index === 1 ? { ...row, amountCents: row.amountCents - 100 } : row,
      ),
      ROWS[2]?.balanceCents ?? 0,
    );
    const response = await post(target, renderPaste(retold));

    expect(response.statusCode).toBe(422);
    const error = refusal(response);
    expect(error.code).toBe("STATEMENT_ROW_CONFLICT");
    expect(error.details).toMatchObject({ fields: ["amount", "balance"] });
    expect(stored(target)).toHaveLength(6);
  });

  test("a paste that reaches back before the oldest stored row is refused, not renumbered", async () => {
    const target = await startApp();
    await report(target, paste(3, 8));
    const before = stored(target);

    // Entirely older, ending where the stored history begins.
    const older = await post(target, paste(0, 3));
    // Older and overlapping: starts before the stored head and runs into it.
    const straddling = await post(target, paste(1, 5));

    for (const response of [older, straddling]) {
      expect(response.statusCode).toBe(422);
      expect(refusal(response)).toMatchObject({
        code: "STATEMENT_BEFORE_HISTORY",
        details: { date: HISTORY[3]?.date, description: HISTORY[3]?.description },
      });
    }
    expect(stored(target)).toEqual(before);
  });

  test("two rows that cannot be told apart are refused as a conflict, not a server error", async () => {
    const target = await startApp();
    const twin: PasteRow = { date: "2026-10-01", description: "Ajustement", amountCents: 0 };

    const response = await post(target, renderPaste(withBalances([twin, twin], 1000)));

    expect(response.statusCode).toBe(422);
    expect(refusal(response).code).toBe("STATEMENT_ROW_CONFLICT");
    expect(stored(target)).toHaveLength(0);
  });

  test("a paste that does not prove itself is refused whole, and stores nothing", async () => {
    const target = await startApp();
    const text = paste(0, 6).replace(/^Total\t.*$/mu, "Total\t+1,00 $");

    const response = await post(target, text);

    expect(response.statusCode).toBe(422);
    expect(refusal(response).code).toBe("STATEMENT_TOTAL_MISMATCH");
    expect(stored(target)).toHaveLength(0);
  });

  test("a paste bigger than the old 64 KiB body cap is stored", async () => {
    const target = await startApp();
    const many: PasteRow[] = Array.from({ length: 500 }, (_, index) => ({
      date: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
      description: `Achat numero ${String(index)} /Marché Exemple`,
      amountCents: -(index + 1),
    }));
    // The paste has to be in date order for its own months to hold together.
    const ordered = many.toSorted((a, b) => a.date.localeCompare(b.date));
    const text = renderPaste(withBalances(ordered, 1_000_000));
    expect(Buffer.byteLength(text)).toBeGreaterThan(64 * 1024);

    const result = await report(target, text);

    expect(result.rowsAdded).toBe(500);
  });

  test.each([
    ["no body at all", undefined],
    ["a body with no text", {}],
    ["an empty text", { text: "" }],
    ["a text that is not a string", { text: 5 }],
  ])("%s is a bad request", async (_name, payload) => {
    const { server } = await startApp();

    const response = await server.inject({
      method: "POST",
      url: ROUTES.statements,
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).toBe(400);
    expect(refusal(response).code).toBe("BAD_REQUEST");
  });

  test("a paste with no rows in it is a bad request, not an empty import", async () => {
    const target = await startApp();

    const response = await post(target, "Date\tDescription\tMontant\tSolde\tlien\n");

    expect(response.statusCode).toBe(400);
    expect(refusal(response).code).toBe("BAD_REQUEST");
  });

  test("is refused without an Access identity, like every API route but health", async () => {
    // The default configuration has no development identity, so a request with
    // no token has nobody to be.
    app = await createApp({ config: { databasePath: ":memory:", logLevel: "silent" } });

    const response = await post(app, paste(0, 3));

    expect(response.statusCode).toBe(403);
    expect(refusal(response).code).toBe("UNAUTHENTICATED");
    expect(stored(app)).toHaveLength(0);
  });

  test("a refusal is logged by code, never with the bank text its details carry", async () => {
    const lines: string[] = [];
    app = await createApp({
      config: {
        databasePath: ":memory:",
        access: accessConfig({ devIdentity: ALEX }),
      },
      logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }),
    });
    await report(app, paste(0, 6));

    // The gap's response names the row it was refused at; the log must not.
    const response = await post(app, paste(8, 10));

    expect(response.statusCode).toBe(422);
    expect(response.body).toContain(HISTORY[8]?.description);
    const logged = lines.join("\n");
    expect(logged).toContain("STATEMENT_CHAIN_BROKEN");
    expect(logged).toContain("unexplainedCents");
    expect(logged).not.toContain(HISTORY[8]?.description);
    expect(logged).not.toContain("Marché");
    expect(logged).not.toContain(String(ROWS[7]?.balanceCents));
  });
});
