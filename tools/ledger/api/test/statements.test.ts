import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { NO_CORRECTIONS } from "@ledger/books";
import { ROUTES } from "@ledger/contract";
import type { ErrorResponse, ImportStatementReport } from "@ledger/contract";
import { householdBooksPath } from "../src/books.ts";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { importWorkbook } from "../src/workbook-import.ts";
import { readSheets } from "../src/xlsx.ts";
import {
  ALEX,
  HOUSEHOLD,
  SAM,
  accessConfig,
  homeBooks,
  memberDirectory,
} from "./helpers/access.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import type { PasteRow } from "./helpers/paste.ts";
import { render } from "./helpers/workbook.ts";
import type { YearRow } from "./helpers/workbook.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

/** Whoever the development identity names is the caller; no token is needed. */
async function startApp(person: string = ALEX): Promise<App> {
  app = await createApp({
    directory: memberDirectory(),
    config: {
      dataDir: ":memory:",
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
  return homeBooks(target)
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
    const target = await startApp();
    const { server } = target;

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
      rowsInInbox: 6,
    });
    // Oldest = 0, in the order the account lived, whatever order the paste listed.
    const rows = homeBooks(target)
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
      rowsInInbox: 0,
    });
    expect(stored(target)).toEqual(before);
    // A paste that stored nothing is not an import: there is no row to point at.
    const imports = homeBooks(target).prepare("SELECT count(*) AS n FROM statement_imports").get();
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
      rowsInInbox: 4,
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
      rowsInInbox: 0,
    });
  });

  test("records who pasted and when, from the identity and the clock", async () => {
    const target = await startApp(SAM);
    await report(target, paste(0, 3));

    const imported = homeBooks(target)
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

  test("two rows with the same four fields are both stored, as the account has them", async () => {
    const target = await startApp();
    const twin: PasteRow = { date: "2026-10-01", description: "Ajustement", amountCents: 0 };

    const result = await report(target, renderPaste(withBalances([twin, twin], 1000)));

    expect(result.rowsAdded).toBe(2);
    expect(stored(target)).toHaveLength(2);
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
    // no token has nobody to be. The household is there so its books can be
    // looked inside afterwards.
    app = await createApp({
      directory: memberDirectory(),
      config: { dataDir: ":memory:", logLevel: "silent" },
    });

    const response = await post(app, paste(0, 3));

    expect(response.statusCode).toBe(403);
    expect(refusal(response).code).toBe("UNAUTHENTICATED");
    expect(stored(app)).toHaveLength(0);
  });

  test("a refusal is logged by code, never with the bank text its details carry", async () => {
    const lines: string[] = [];
    app = await createApp({
      directory: memberDirectory(),
      config: {
        dataDir: ":memory:",
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

// What the first gate found (F1 to F7), and what the owner decided on 2026-10-02.
// Appended as a block of its own: the tests above are cited by line.

/** A paste of these rows, oldest first, from an opening balance of 50,00. */
const of = (rows: PasteRow[], opening = 5000): string => renderPaste(withBalances(rows, opening));

describe("a row's identity is not unique, so a paste is read by position", () => {
  const X: PasteRow = { date: "2026-10-01", description: "Virement X", amountCents: 1000 };
  const RETOUR: PasteRow = { date: "2026-10-01", description: "Retour", amountCents: -1000 };
  const Y: PasteRow = { date: "2026-10-02", description: "Achat Y", amountCents: -200 };
  const Z: PasteRow = { date: "2026-09-30", description: "Depot Z", amountCents: 300 };

  test("a transfer repeated after its reversal is never silently dropped as the stored one", async () => {
    const target = await startApp();
    await report(target, of([X, RETOUR]));
    const before = stored(target);

    // Opens from 50,00, where the stored history ends, and is also the stored
    // first row. At c214024 this answered 200 with `rowsAdded: 0`.
    const response = await post(target, of([X]));

    expect(response.statusCode).toBe(422);
    const error = refusal(response);
    expect(error.code).toBe("STATEMENT_ROW_CONFLICT");
    expect(error.details).toMatchObject({
      readings: [
        { rowsAdded: 0, rowsAlreadyPresent: 1 },
        { rowsAdded: 1, rowsAlreadyPresent: 0 },
      ],
    });
    expect(stored(target)).toEqual(before);
  });

  test("starting the same paste on the reversal settles it: the transfer is a new row", async () => {
    const target = await startApp();
    await report(target, of([X, RETOUR]));

    const result = await report(target, of([RETOUR, X], 6000));

    expect(result).toEqual({
      rowsAdded: 1,
      rowsAlreadyPresent: 1,
      tailBalanceCents: 6000,
      rowsInInbox: 1,
    });
    expect(stored(target).map((row) => row.description)).toEqual([
      "Virement X",
      "Retour",
      "Virement X",
    ]);
  });

  test("the whole stretch, transfer, reversal and transfer again, is stored", async () => {
    const target = await startApp();

    const result = await report(target, of([X, RETOUR, X, Y]));

    expect(result).toMatchObject({ rowsAdded: 4, rowsAlreadyPresent: 0 });
    expect(stored(target)).toHaveLength(4);
  });

  test("a continuation from the stored tail may start with a row the history already holds", async () => {
    const target = await startApp();
    await report(target, of([X, RETOUR]));

    const result = await report(target, of([X, Y]));

    expect(result).toMatchObject({ rowsAdded: 2, rowsAlreadyPresent: 0 });
    expect(stored(target)).toHaveLength(4);
  });

  test("a paste that can be read as stored rows or as new ones is refused naming both, and stores nothing", async () => {
    const target = await startApp();
    await report(target, of([X, RETOUR]));
    const before = stored(target);

    // Either the last rows pasted again with two more, or a second round of the same.
    const response = await post(target, of([X, RETOUR, X, Y]));

    expect(response.statusCode).toBe(422);
    const error = refusal(response);
    expect(error.code).toBe("STATEMENT_ROW_CONFLICT");
    expect(error.details).toMatchObject({
      readings: [
        { rowsAdded: 2, rowsAlreadyPresent: 2 },
        { rowsAdded: 4, rowsAlreadyPresent: 0 },
      ],
    });
    expect(error.message).toContain("longer");
    expect(stored(target)).toEqual(before);
  });

  test("a longer stretch that starts on an earlier row settles which reading is meant", async () => {
    const target = await startApp();
    await report(target, of([Z, X, RETOUR], 4700));

    const result = await report(target, of([Z, X, RETOUR, X, Y], 4700));

    expect(result).toEqual({
      rowsAdded: 2,
      rowsAlreadyPresent: 3,
      tailBalanceCents: 5800,
      rowsInInbox: 2,
    });
  });

  test("a paste of rows the history holds twice over is refused, never guessed at", async () => {
    const target = await startApp();
    await report(target, of([X, RETOUR, X]));

    // The same text again: the last X, or all three? The books cannot tell.
    const response = await post(target, of([X, RETOUR, X]));

    expect(response.statusCode).toBe(422);
    expect(refusal(response).code).toBe("STATEMENT_ROW_CONFLICT");
    expect(stored(target)).toHaveLength(3);
  });

  test("a continuation that ends on the balance the history began from is not older history", async () => {
    const target = await startApp();
    const up: PasteRow = { date: "2026-10-01", description: "Depot", amountCents: 500 };
    const down: PasteRow = { date: "2026-10-02", description: "Retrait", amountCents: -500 };
    await report(target, renderPaste(withBalances([up], 1000)));

    const result = await report(target, renderPaste(withBalances([down], 1500)));

    expect(result).toEqual({
      rowsAdded: 1,
      rowsAlreadyPresent: 0,
      tailBalanceCents: 1000,
      rowsInInbox: 1,
    });
  });

  test("an older paste that stops short of the oldest stored row is older history, not a gap", async () => {
    const target = await startApp();
    await report(target, paste(3, 8));

    const response = await post(target, paste(0, 2));

    expect(response.statusCode).toBe(422);
    expect(refusal(response).code).toBe("STATEMENT_BEFORE_HISTORY");
    expect(stored(target)).toHaveLength(5);
  });

  test("a new row takes the position after the highest stored one, not the row count", async () => {
    const target = await startApp();
    await report(target, paste(0, 3));
    // Older rows may later be numbered below the oldest, so positions are not 0..n.
    homeBooks(target).prepare("UPDATE statement_rows SET seq = seq - 5").run();

    await report(target, paste(3, 6));

    expect(stored(target).map((row) => row.seq)).toEqual([-5, -4, -3, -2, -1, 0]);
  });

  test("a row before a shared stretch that is not the stored row there is refused and named", async () => {
    const target = await startApp();
    await report(target, paste(0, 6));
    const before = stored(target);

    const retold = ROWS.slice(3, 8).map((row, index) =>
      index === 0 ? { ...row, description: "Autre libelle" } : row,
    );
    const response = await post(target, renderPaste(retold));

    expect(response.statusCode).toBe(422);
    const error = refusal(response);
    expect(error.code).toBe("STATEMENT_ROW_CONFLICT");
    expect(error.details).toMatchObject({
      fields: ["description"],
      stored: { seq: 3, description: HISTORY[3]?.description },
      pasted: { pasteIndex: 0, description: "Autre libelle" },
    });
    expect(stored(target)).toEqual(before);
  });
});

describe("an over-long paste and a busy database", () => {
  test("a body over the cap is a 413 saying the paste is too long", async () => {
    const { server } = await startApp();

    const response = await server.inject({
      method: "POST",
      url: ROUTES.statements,
      payload: { text: "x".repeat(1024 * 1024 + 10) },
    });

    expect(response.statusCode).toBe(413);
    const error = refusal(response);
    expect(error.code).toBe("SIZE_LIMIT_EXCEEDED");
    expect(error.message).toContain("The paste is too long");
  });

  test("a write lock held by another connection answers a retryable timeout, and stores nothing", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ledger-busy-"));
    let other: Database.Database | undefined;
    try {
      app = await createApp({
        directory: memberDirectory(),
        config: {
          dataDir: dir,
          logLevel: "silent",
          access: accessConfig({ devIdentity: ALEX }),
        },
      });
      // The 5 s the server waits is the production value; a test must not.
      homeBooks(app).pragma("busy_timeout = 50");
      other = new Database(householdBooksPath(dir, HOUSEHOLD));
      other.prepare("BEGIN IMMEDIATE").run();

      const response = await post(app, paste(0, 3));

      expect(response.statusCode).toBe(504);
      expect(refusal(response)).toMatchObject({ code: "TIMEOUT", retryable: true });
      other.prepare("ROLLBACK").run();
      expect(stored(app)).toHaveLength(0);
      // The same paste goes through once the lock is gone.
      expect((await post(app, paste(0, 3))).statusCode).toBe(200);
    } finally {
      other?.close();
      await app?.shutdown();
      app = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("older history, or a gap after the history", () => {
  test("a paste dated after the history that ends on its opening balance is a gap, not older history", async () => {
    const target = await startApp();
    const deposit: PasteRow = { date: "2026-10-01", description: "Depot", amountCents: 500 };
    const purchase: PasteRow = { date: "2026-10-05", description: "Achat", amountCents: -200 };
    await report(target, renderPaste(withBalances([deposit], 1000)));
    const before = stored(target);

    // Ends on 10,00, the balance the history opened from, but opens from 12,00
    // where the history ended on 15,00: 3,00 went out between, and it is later.
    const response = await post(target, renderPaste(withBalances([purchase], 1200)));

    expect(response.statusCode).toBe(422);
    const error = refusal(response);
    expect(error.code).toBe("STATEMENT_CHAIN_BROKEN");
    expect(error.details).toMatchObject({ unexplainedCents: -300 });
    expect(error.message).toContain("-3.00 $ is unexplained");
    expect(stored(target)).toEqual(before);
  });
});

// Where a paste that shares nothing with the history lies against it: older
// history, or a gap after it. The edges, gate 3's table.
describe("a paste that shares nothing with the history, by date", () => {
  /** The stored rows 3 to 7: the oldest on 2026-09-12, the newest on 2026-10-01. */
  async function spanningSeveralDays(): Promise<{ target: App; before: StoredRowColumns[] }> {
    const target = await startApp();
    await report(target, paste(3, 8));
    return { target, before: stored(target) };
  }

  const headOpening = ROWS[2]?.balanceCents ?? 0;

  async function refused(target: App, row: PasteRow, opening: number) {
    const response = await post(target, renderPaste(withBalances([row], opening)));
    expect(response.statusCode).toBe(422);
    return refusal(response);
  }

  test("the day before the oldest row, on the balance it opened from, is older history", async () => {
    const { target, before } = await spanningSeveralDays();
    const row: PasteRow = { date: "2026-09-11", description: "Autre", amountCents: 700 };

    const error = await refused(target, row, headOpening - 700);

    expect(error.code).toBe("STATEMENT_BEFORE_HISTORY");
    expect(stored(target)).toEqual(before);
  });

  test("the day before the oldest row, on another balance, is older history", async () => {
    const { target } = await spanningSeveralDays();
    const row: PasteRow = { date: "2026-09-11", description: "Autre", amountCents: 700 };

    expect((await refused(target, row, 1000)).code).toBe("STATEMENT_BEFORE_HISTORY");
  });

  test("the oldest row's day, on the balance it opened from, is older history", async () => {
    const { target } = await spanningSeveralDays();
    const row: PasteRow = { date: "2026-09-12", description: "Autre", amountCents: 700 };

    expect((await refused(target, row, headOpening - 700)).code).toBe("STATEMENT_BEFORE_HISTORY");
  });

  test("the oldest row's day, on another balance, is older history when the history runs past that day", async () => {
    const { target, before } = await spanningSeveralDays();
    const row: PasteRow = { date: "2026-09-12", description: "Autre", amountCents: 700 };

    // At 1234701 this answered a gap, with an "unexplained" amount that is only
    // the distance from the newest stored row, which a paste dated on the oldest
    // row's day cannot follow.
    const error = await refused(target, row, 1000);

    expect(error.code).toBe("STATEMENT_BEFORE_HISTORY");
    expect(stored(target)).toEqual(before);
  });

  test("a one-day history, and a paste on that day ending on the balance it opened from, is older history", async () => {
    const target = await startApp();
    await report(
      target,
      renderPaste(
        withBalances([{ date: "2026-10-01", description: "Depot", amountCents: 500 }], 1000),
      ),
    );
    const row: PasteRow = { date: "2026-10-01", description: "Retrait", amountCents: -200 };

    // Opens from 12,00, not the stored 15,00, and ends on the 10,00 the history opened from.
    expect((await refused(target, row, 1200)).code).toBe("STATEMENT_BEFORE_HISTORY");
  });
});

// lg-40: a paste meeting rows the workbook imported into empty books. The
// workbook's rows carry its own wording and no category, date a row a day off
// now and then, and list a day's movements in their own order.
describe("a paste that meets the workbook's rows", () => {
  /** The workbook's rows, oldest first, from an empty account: 1 000.00 in, then the ticket's four. */
  const WORKBOOK: YearRow[] = [
    {
      written: "2026-02-16",
      bucket: "Hypothèque",
      detail: "Versement",
      person: "Alex",
      amount: 1000,
    },
    {
      written: "2026-03-01",
      bucket: "Dép. Courantes",
      detail: "Dépôt",
      person: "Alex",
      amount: 100,
    },
    { written: "2026-03-01", bucket: "Dép. Courantes", detail: "Dépôt", person: "Sam", amount: 50 },
    { written: "2026-03-01", bucket: "Dép. Courantes", detail: "Taxes", amount: -200 },
    { written: "2026-03-10", bucket: "Hypothèque", detail: "Paiement", amount: -300 },
  ];

  /** The same movements in the bank's words. */
  const BANK = {
    deposit: {
      date: "2026-03-01",
      description: "Virement - AccèsD Internet /Caisse du Lac",
      amountCents: 10_000,
    },
    transfer: {
      date: "2026-03-01",
      description: "Virement entre folios /Caisse du Lac",
      amountCents: 5_000,
    },
    taxes: {
      date: "2026-03-01",
      category: "Taxes municipales/scolaires",
      description: "Taxes /Ville Exemple",
      amountCents: -20_000,
    },
    payment: {
      date: "2026-03-10",
      category: "Loyer/Prêt hypothécaire",
      description: "Hypothèque /Prêteur Exemple",
      amountCents: -30_000,
    },
  } satisfies Record<string, PasteRow>;

  /**
   * The same movements in the workbook's own words. A paste always carries a
   * category and the workbook's is empty, so only the description can be the
   * workbook's.
   */
  const OWN = {
    deposit: { date: "2026-03-01", description: "Dépôt", amountCents: 10_000 },
    transfer: { date: "2026-03-01", description: "Dépôt", amountCents: 5_000 },
    taxes: { date: "2026-03-01", description: "Taxes", amountCents: -20_000 },
    payment: { date: "2026-03-10", description: "Paiement", amountCents: -30_000 },
  } satisfies Record<string, PasteRow>;

  /** The one row after the workbook's newest. */
  const PURCHASE: PasteRow = {
    date: "2026-03-12",
    category: "Épicerie",
    description: "Achat /Marché Exemple",
    amountCents: -2_000,
  };

  /** What the account held before the 1 March movements, on both sides. */
  const BEFORE_MARCH = 100_000;

  /** The workbook imported into these books, through lg-7's own import; the rows it stored. */
  async function workbookInto(
    target: App,
    rows: YearRow[] = WORKBOOK,
  ): Promise<StoredRowColumns[]> {
    const sheets = await readSheets(
      await render({
        years: [{ year: 2026, carry: { mortgage: 0, buffer: 0 }, rows }],
        periods: [],
        salaries: { alex: 60_000, sam: 40_000 },
      }),
    );
    const result = importWorkbook(homeBooks(target), sheets, {
      personId: "alex",
      members: ["alex", "sam"],
      corrections: NO_CORRECTIONS,
      write: true,
      commit: true,
      now: () => new Date("2026-10-01T09:00:00Z"),
    });
    expect(result.written, result.report).toBe(true);
    return stored(target);
  }

  test("a paste reaching back into the workbook's rows adds only the row after them, and leaves theirs as they were", async () => {
    const target = await startApp();
    const before = await workbookInto(target);
    expect(
      before.map((row) => [
        row.date,
        row.category,
        row.description,
        row.amount_cents,
        row.balance_cents,
      ]),
    ).toEqual([
      ["2026-02-16", "", "Versement", 100_000, 100_000],
      ["2026-03-01", "", "Dépôt", 10_000, 110_000],
      ["2026-03-01", "", "Dépôt", 5_000, 115_000],
      ["2026-03-01", "", "Taxes", -20_000, 95_000],
      ["2026-03-10", "", "Paiement", -30_000, 65_000],
    ]);

    // The bank's words, 1 March in the bank's order (balances 800, 900, 950),
    // and the payment dated the 9th.
    const result = await report(
      target,
      of(
        [
          BANK.taxes,
          BANK.deposit,
          BANK.transfer,
          { ...BANK.payment, date: "2026-03-09" },
          PURCHASE,
        ],
        BEFORE_MARCH,
      ),
    );

    expect(result).toEqual({
      rowsAdded: 1,
      rowsAlreadyPresent: 4,
      tailBalanceCents: 63_000,
      rowsInInbox: 1,
    });
    const after = stored(target);
    expect(after.slice(0, 5)).toEqual(before);
    expect(after[5]).toMatchObject({
      seq: (before.at(-1)?.seq ?? 0) + 1,
      date: "2026-03-12",
      category: "Épicerie",
      description: "Achat /Marché Exemple",
      amount_cents: -2_000,
      balance_cents: 63_000,
    });
  });

  test.each([
    ["its wording alone", [BANK.deposit, BANK.transfer, BANK.taxes, BANK.payment]],
    [
      "a date a day off alone",
      [OWN.deposit, OWN.transfer, OWN.taxes, { ...OWN.payment, date: "2026-03-11" }],
    ],
    ["the order of one day's rows alone", [OWN.taxes, OWN.deposit, OWN.transfer, OWN.payment]],
  ])("a paste that differs from the workbook in %s is accepted", async (_, overlap) => {
    const target = await startApp();
    const before = await workbookInto(target);

    const result = await report(target, of([...overlap, PURCHASE], BEFORE_MARCH));

    expect(result).toEqual({
      rowsAdded: 1,
      rowsAlreadyPresent: 4,
      tailBalanceCents: 63_000,
      rowsInInbox: 1,
    });
    expect(stored(target).slice(0, 5)).toEqual(before);
  });

  test.each([
    [
      "a date two days off",
      [BANK.taxes, BANK.deposit, BANK.transfer, { ...BANK.payment, date: "2026-03-08" }],
    ],
    [
      // −200, +90, +60 ends the day on 950.00, as the workbook's does.
      "a reordered day whose amounts differ by one row",
      [
        BANK.taxes,
        { ...BANK.deposit, amountCents: 9_000 },
        { ...BANK.transfer, amountCents: 6_000 },
        BANK.payment,
      ],
    ],
  ])(
    "a paste that differs from the workbook by %s is refused, and stores nothing",
    async (_, overlap) => {
      const target = await startApp();
      const before = await workbookInto(target);

      const response = await post(target, of([...overlap, PURCHASE], BEFORE_MARCH));

      expect(response.statusCode).toBe(422);
      expect(refusal(response).code).toBe("STATEMENT_CHAIN_BROKEN");
      expect(stored(target)).toEqual(before);
    },
  );

  test("rows a paste stored above the workbook's are still compared field for field, and in order", async () => {
    const target = await startApp();
    await workbookInto(target);
    await report(
      target,
      of([BANK.taxes, BANK.deposit, BANK.transfer, BANK.payment, PURCHASE], BEFORE_MARCH),
    );
    const x: PasteRow = { date: "2026-03-20", description: "Virement X", amountCents: 1_000 };
    const y: PasteRow = { date: "2026-03-20", description: "Retrait Y", amountCents: 500 };
    const z: PasteRow = { date: "2026-03-20", description: "Achat Z", amountCents: -2_500 };
    const w: PasteRow = { date: "2026-03-21", description: "Achat W", amountCents: -100 };
    await report(target, of([x, y, z], 63_000));
    const before = stored(target);

    // A pasted row whose category differs is refused and named, as ever.
    const recategorised = await post(target, of([{ ...PURCHASE, category: "Divers" }, x], 65_000));
    expect(recategorised.statusCode).toBe(422);
    expect(refusal(recategorised)).toMatchObject({
      code: "STATEMENT_ROW_CONFLICT",
      details: { fields: ["category"], stored: { category: "Épicerie" } },
    });

    // A pasted day in another order is not the stored day.
    const reordered = await post(target, of([z, x, y, w], 63_000));
    expect(reordered.statusCode).toBe(422);
    expect(refusal(reordered).code).toBe("STATEMENT_CHAIN_BROKEN");
    expect(refusal(reordered).message).toContain("paste a longer stretch");
    expect(stored(target)).toEqual(before);
  });

  test("a paste that fits nowhere after the workbook's rows says so, naming its newest row and where to start", async () => {
    const lines: string[] = [];
    app = await createApp({
      directory: memberDirectory(),
      config: { dataDir: ":memory:", access: accessConfig({ devIdentity: ALEX }) },
      logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }),
      now: () => new Date("2026-10-02T09:30:00Z"),
    });
    const before = await workbookInto(app);

    const response = await post(
      app,
      of(
        [
          BANK.taxes,
          BANK.deposit,
          BANK.transfer,
          { ...BANK.payment, date: "2026-03-08" },
          PURCHASE,
        ],
        BEFORE_MARCH,
      ),
    );

    expect(response.statusCode).toBe(422);
    const error = refusal(response);
    expect(error.code).toBe("STATEMENT_CHAIN_BROKEN");
    expect(error.message).toContain(
      'imported from the workbook, which end on 2026-03-10 "Paiement"',
    );
    expect(error.message).toContain('2026-03-12 "Achat /Marché Exemple"');
    expect(error.message).not.toContain("paste a longer stretch");
    expect(error.details).toEqual({
      date: "2026-03-10",
      description: "Paiement",
      amountCents: -30_000,
      balanceCents: 65_000,
      continuesAt: {
        pasteIndex: 4,
        date: "2026-03-12",
        description: "Achat /Marché Exemple",
        amountCents: -2_000,
        balanceCents: 63_000,
      },
    });
    expect(stored(app)).toEqual(before);
    const logged = lines.join("\n");
    expect(logged).toContain("STATEMENT_CHAIN_BROKEN");
    expect(logged).toContain("continuesAt");
    expect(logged).not.toContain("Paiement");
    expect(logged).not.toContain("Marché");

    // With no pasted row opening from the workbook's last balance, none is named.
    const gap = await post(
      app,
      of(
        [{ date: "2026-03-15", description: "Achat /Autre Exemple", amountCents: -1_000 }],
        60_000,
      ),
    );
    expect(gap.statusCode).toBe(422);
    expect(refusal(gap).message).toContain("workbook");
    expect(refusal(gap).message).not.toContain("paste a longer stretch");
    expect(refusal(gap).details).toMatchObject({ description: "Paiement", continuesAt: null });
  });

  test("a reading only the day's order makes possible counts like any other, so two readings are refused", async () => {
    const target = await startApp();
    const before = await workbookInto(target, [
      WORKBOOK[0] as YearRow,
      {
        written: "2026-03-01",
        bucket: "Dép. Courantes",
        detail: "Retour",
        person: "Sam",
        amount: -10,
      },
      {
        written: "2026-03-01",
        bucket: "Dép. Courantes",
        detail: "Virement",
        person: "Sam",
        amount: 10,
      },
    ]);
    const x: PasteRow = {
      date: "2026-03-01",
      description: "Virement /Caisse du Mont",
      amountCents: 1_000,
    };
    const back: PasteRow = {
      date: "2026-03-01",
      description: "Retour /Caisse du Mont",
      amountCents: -1_000,
    };
    const y: PasteRow = { date: "2026-03-02", description: "Achat Y", amountCents: -200 };

    // The stored day in the bank's order with two more rows, or the same again after it.
    const response = await post(target, of([x, back, x, y], BEFORE_MARCH));

    expect(response.statusCode).toBe(422);
    const error = refusal(response);
    expect(error.code).toBe("STATEMENT_ROW_CONFLICT");
    expect(error.details).toMatchObject({
      readings: [
        { rowsAdded: 2, rowsAlreadyPresent: 2 },
        { rowsAdded: 4, rowsAlreadyPresent: 0 },
      ],
    });
    expect(stored(target)).toEqual(before);
  });

  test("a paste wholly inside the workbook's rows, in another order and other words, adds nothing", async () => {
    const target = await startApp();
    const before = await workbookInto(target);

    const result = await report(
      target,
      of([BANK.taxes, BANK.deposit, BANK.transfer], BEFORE_MARCH),
    );

    expect(result).toEqual({
      rowsAdded: 0,
      rowsAlreadyPresent: 3,
      tailBalanceCents: 65_000,
      rowsInInbox: 0,
    });
    expect(stored(target)).toEqual(before);
  });
});

// lg-40, gate 1: a paste that starts or ends partway through one of the
// workbook's days (F1, F2), and what no test asserted before (F3). The workbook
// rows are written as the import writes them, under a `'workbook'` import with
// an empty category, so a day can hold any order.

interface Movement {
  date: string;
  amountCents: number;
}

/** These movements stored as the workbook import stores them, oldest first. */
function workbookRows(target: App, rows: readonly Movement[], opening: number): void {
  const db = homeBooks(target);
  const batch = db
    .prepare(
      "INSERT INTO statement_imports (imported_at, imported_by, source) VALUES (?, ?, 'workbook')",
    )
    .run("2026-10-01T09:00:00Z", "alex");
  const insert = db.prepare(
    `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id)
     VALUES (?, ?, '', ?, ?, ?, ?)`,
  );
  let balance = opening;
  for (const [seq, row] of rows.entries()) {
    balance += row.amountCents;
    insert.run(
      seq,
      row.date,
      `Ligne ${String(seq)}`,
      row.amountCents,
      balance,
      batch.lastInsertRowid,
    );
  }
}

/** A movement as the bank words it. */
function bankRow(row: Movement, index: number): PasteRow {
  return { ...row, description: `Virement /Caisse ${String(index)}` };
}

describe("a paste partway through one of the workbook's days", () => {
  // The bank's 5 March, oldest first: +10.00, −3.00, +0.70, from 1 000.00.
  const BANK_DAY: Movement[] = [
    { date: "2026-03-05", amountCents: 1_000 },
    { date: "2026-03-05", amountCents: -300 },
    { date: "2026-03-05", amountCents: 70 },
  ];
  const NEXT: Movement = { date: "2026-03-06", amountCents: -250 };
  const ORDERS = [
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ] as const;

  test.each(ORDERS.flatMap((order) => [1, 2].map((start) => [order.join(","), start] as const)))(
    "a day the workbook lists as %s, pasted from the bank's row %i of it on, adds only the new row (F1)",
    async (listed, start) => {
      const target = await startApp();
      const order = listed.split(",").map(Number);
      workbookRows(
        target,
        order.map((index) => BANK_DAY[index] as Movement),
        100_000,
      );
      const before = stored(target);
      const opening =
        100_000 + BANK_DAY.slice(0, start).reduce((sum, row) => sum + row.amountCents, 0);

      const result = await report(
        target,
        of([...BANK_DAY.slice(start), NEXT].map(bankRow), opening),
      );

      expect(result).toEqual({
        rowsAdded: 1,
        rowsAlreadyPresent: 3 - start,
        tailBalanceCents: 100_520,
        rowsInInbox: 1,
      });
      expect(stored(target).slice(0, 3)).toEqual(before);
    },
  );

  test("a paste whose rows fit a reordered day two ways is refused, not stored as one of them (F2)", async () => {
    const target = await startApp();
    // The bank's day is −10, +10, +10, +10; the workbook holds its first three,
    // listed +10, +10, −10, so the balances it shows inside the day are its own.
    workbookRows(
      target,
      [1_000, 1_000, -1_000].map((amountCents) => ({ date: "2026-03-05", amountCents })),
      100_000,
    );
    const before = stored(target);
    const lastTwo = [1_000, 1_000].map((amountCents, index) =>
      bankRow({ date: "2026-03-05", amountCents }, index),
    );

    // The bank's last two rows: its third, which the workbook holds, and its
    // fourth, which is new. Or the workbook's day may begin with those two.
    const response = await post(target, of(lastTwo, 100_000));

    expect(response.statusCode).toBe(422);
    const error = refusal(response);
    expect(error.code).toBe("STATEMENT_ROW_CONFLICT");
    expect(error.details).toMatchObject({
      readings: [
        { rowsAdded: 0, rowsAlreadyPresent: 2 },
        { rowsAdded: 1, rowsAlreadyPresent: 1 },
      ],
    });
    expect(stored(target)).toEqual(before);

    // With the next day's row, only the true reading fits.
    const result = await report(target, of([...lastTwo, bankRow(NEXT, 2)], 100_000));
    expect(result).toEqual({
      rowsAdded: 2,
      rowsAlreadyPresent: 1,
      tailBalanceCents: 101_750,
      rowsInInbox: 2,
    });
    expect(stored(target).map((row) => [row.amount_cents, row.balance_cents])).toEqual([
      [1_000, 101_000],
      [1_000, 102_000],
      [-1_000, 101_000],
      [1_000, 102_000],
      [-250, 101_750],
    ]);
  });

  /** The workbook's 1 March of three movements and its 10 March, from 1 000.00. */
  function march(target: App): StoredRowColumns[] {
    workbookRows(
      target,
      [
        { date: "2026-03-01", amountCents: 10_000 },
        { date: "2026-03-01", amountCents: 5_000 },
        { date: "2026-03-01", amountCents: -20_000 },
        { date: "2026-03-10", amountCents: -30_000 },
      ],
      100_000,
    );
    return stored(target);
  }

  test.each(["2026-02-28", "2026-03-02"])(
    "a paste wholly inside the workbook's rows, in the bank's order and dated %s, a day off, adds nothing (F3)",
    async (date) => {
      const target = await startApp();
      const before = march(target);

      const result = await report(
        target,
        of(
          [-20_000, 10_000, 5_000].map((amountCents, index) =>
            bankRow({ date, amountCents }, index),
          ),
          100_000,
        ),
      );

      expect(result).toEqual({
        rowsAdded: 0,
        rowsAlreadyPresent: 3,
        tailBalanceCents: 65_000,
        rowsInInbox: 0,
      });
      expect(stored(target)).toEqual(before);
    },
  );

  test.each(["2026-02-27", "2026-03-03"])(
    "a paste wholly inside the workbook's rows but dated %s, two days off, is refused (F3)",
    async (date) => {
      const target = await startApp();
      const before = march(target);

      const response = await post(
        target,
        of(
          [-20_000, 10_000, 5_000].map((amountCents, index) =>
            bankRow({ date, amountCents }, index),
          ),
          100_000,
        ),
      );

      expect(response.statusCode).toBe(422);
      expect(stored(target)).toEqual(before);
    },
  );

  test("a pasted row dated before the workbook's newest day is not named as continuing it, whatever its balance (F3)", async () => {
    const target = await startApp();
    march(target);

    // The second row opens from 650.00, the balance the workbook's 10 March
    // left, but is dated the 5th: it cannot be the row after the 10th.
    const response = await post(
      target,
      of(
        [
          { date: "2026-03-04", amountCents: 500 },
          { date: "2026-03-05", amountCents: -100 },
        ].map(bankRow),
        64_500,
      ),
    );

    expect(response.statusCode).toBe(422);
    const error = refusal(response);
    expect(error.code).toBe("STATEMENT_CHAIN_BROKEN");
    expect(error.details).toMatchObject({ date: "2026-03-10", continuesAt: null });
    expect(error.message).not.toContain("a paste that starts on that row continues the workbook");
  });
});

// lg-40, gate 2, F7: what a paste wholly inside the workbook's rows needs of the
// rest of the day it starts or ends partway through. The day sits between an
// earlier day and a later one, so neither edge of the history is its own.
describe("a paste wholly inside a reordered day the workbook lists between two others (F7)", () => {
  /** The workbook's 4 March, one 5 March in the order given, and 6 March, from 1 000.00. */
  function between(target: App, bankDay: readonly number[], listed: readonly number[]): void {
    workbookRows(
      target,
      [
        { date: "2026-03-04", amountCents: 900 },
        ...listed.map((index) => ({
          date: "2026-03-05",
          amountCents: bankDay[index] as number,
        })),
        { date: "2026-03-06", amountCents: -250 },
      ],
      100_000,
    );
  }

  /** The bank's rows `from` to `to` of its 5 March, from the balance before them. */
  function part(bankDay: readonly number[], from: number, to: number): string {
    const opening =
      100_000 + 900 + bankDay.slice(0, from).reduce((sum, amountCents) => sum + amountCents, 0);
    return of(
      bankDay
        .slice(from, to)
        .map((amountCents, index) => bankRow({ date: "2026-03-05", amountCents }, from + index)),
      opening,
    );
  }

  const THREE = [-1_234, 5_600, -777];
  const FIVE = [-1_234, 5_600, -777, 310, 4_408];

  test.each(["0,1,2", "0,2,1", "1,0,2", "1,2,0", "2,0,1", "2,1,0"])(
    "a day of three listed as %s, pasted from any of the bank's rows to any other inside it, adds nothing",
    async (listed) => {
      const target = await startApp();
      between(target, THREE, listed.split(",").map(Number));
      const before = stored(target);

      // Every part that ends before the day does, so the workbook's rows after
      // it are the rest of the day: not the next day's.
      for (const [from, to] of [
        [0, 1],
        [0, 2],
        [1, 2],
      ] as const) {
        const result = await report(target, part(THREE, from, to));

        expect(result, `rows ${String(from)} to ${String(to)}`).toEqual({
          rowsAdded: 0,
          rowsAlreadyPresent: to - from,
          tailBalanceCents: 100_000 + 900 - 1_234 + 5_600 - 777 - 250,
          rowsInInbox: 0,
        });
      }
      expect(stored(target)).toEqual(before);
    },
  );

  test.each(["0,1,2,3,4", "4,3,2,1,0", "2,3,4,0,1"])(
    "a day of five listed as %s, pasted from a row with two or three before it, adds nothing",
    async (listed) => {
      const target = await startApp();
      between(target, FIVE, listed.split(",").map(Number));
      const before = stored(target);

      // The rows before the part must be read oldest first, since the day's
      // opening balance is the first of them taken away.
      for (const [from, count] of [
        [2, 1],
        [2, 2],
        [3, 1],
      ] as const) {
        const result = await report(target, part(FIVE, from, from + count));

        expect(result.rowsAdded, `rows ${String(from)} on`).toBe(0);
        expect(result.rowsAlreadyPresent).toBe(count);
      }
      expect(stored(target)).toEqual(before);
    },
  );
});
