/**
 * The workbook import (lg-7), through the command: a synthetic workbook built
 * by the test (`helpers/workbook.ts`), imported into a database file, and the
 * books read back. Every name, description and amount is invented.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { bucketsAsOf } from "../src/buckets.ts";
import { classifyRow } from "../src/classifications.ts";
import { migrate } from "../src/db/schema.ts";
import { runImportCommand } from "../src/import-command.ts";
import { enrollPeople } from "../src/people.ts";
import { closedPeriods, currentLines } from "../src/periods.ts";
import { currentRatios, currentSalaries } from "../src/salaries.ts";
import { importStatement } from "../src/statements.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import { history, render } from "./helpers/workbook.ts";
import type { Fixture } from "./helpers/workbook.ts";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const PEOPLE = "alex@example.test=alex,sam@example.test=sam";

let dir: string;
let databasePath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ledger-workbook-"));
  databasePath = path.join(dir, "books", "ledger.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Ran {
  code: number;
  out: string;
  err: string;
}

async function run(...args: string[]): Promise<Ran> {
  let out = "";
  let err = "";
  const code = await runImportCommand(args, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    env: { DATABASE_PATH: databasePath, ACCESS_PEOPLE: PEOPLE },
    cwd: dir,
    now: () => NOW,
  });
  return { code, out, err };
}

async function workbook(fixture: Fixture = history()): Promise<string> {
  writeFileSync(path.join(dir, "classeur.xlsx"), await render(fixture));
  return "classeur.xlsx";
}

/** The books as they stand, opened afresh, with the people enrolled as boot would. */
function books(): Database.Database {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  migrate(db);
  return db;
}

/** Every row of every table, for "nothing changed". */
function dump(db: Database.Database): Record<string, unknown[]> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]),
  );
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("the workbook import", () => {
  test("a dry run reports every repair and skip, and writes nothing", async () => {
    // Books with something in them, closed so the file holds everything.
    const db = books();
    enrollPeople(db, ["alex", "sam"], NOW);
    db.pragma("wal_checkpoint(TRUNCATE)");
    const before = dump(db);
    db.close();
    const hash = sha256(databasePath);

    const ran = await run(await workbook(), "--as", "alex");

    expect(ran.err).toBe("");
    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain("Dry run: nothing will be written.");
    // The typo'd year, 2022's third row, and the placeholder after it.
    expect(ran.out).toContain("repaired: 2022 row 3, 2012-06-15 → 2022-06-15 (the sheet's year)");
    expect(ran.out).toContain("skipped: 2022 row 4, no amount");
    expect(ran.out).toMatch(/repaired +1\n/u);
    expect(ran.out).toMatch(/skipped +1\n/u);
    expect(ran.out).toMatch(/imported +17\n/u);
    expect(ran.out).toContain("nothing was written");

    expect(sha256(databasePath)).toBe(hash);
    const after = new Database(databasePath, { readonly: true });
    expect(dump(after)).toEqual(before);
    after.close();
  });

  test("a dry run into books that do not exist yet does not create them", async () => {
    const ran = await run(await workbook(), "--as", "alex");

    expect(ran.code, ran.out).toBe(0);
    expect(existsSync(databasePath)).toBe(false);
    expect(existsSync(path.dirname(databasePath))).toBe(false);
  });

  test("a carry-over that disagrees with the year before fails the import, with a nonzero exit", async () => {
    const fixture = history();
    const year = fixture.years[1];
    if (year === undefined) throw new Error("the fixture has no 2023");
    year.carry.buffer = 579;

    const ran = await run(await workbook(fixture), "--as", "alex", "--write");

    expect(ran.code, ran.err).toBe(1);
    expect(ran.out).toContain(
      "2023!G8: carries 579.00 into the current-expenses bucket, but 2022 closed it at 580.00 (-1.00 unexplained).",
    );
    expect(ran.out).toContain("Refused: nothing was written.");
    const db = books();
    expect(db.prepare("SELECT count(*) AS n FROM statement_rows").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM periods").get()).toEqual({ n: 0 });
    db.close();
  });

  test("--write reproduces the workbook's mortgage gap and buffer balance exactly", async () => {
    const ran = await run(await workbook(), "--as", "alex", "--write");

    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain("Written.");
    const db = books();
    const buckets = bucketsAsOf(db, "2024-12-31");
    // Worked by hand in helpers/workbook.ts.
    expect(buckets.mortgage.own).toEqual([
      { personId: "alex", ownCents: 94_999 },
      { personId: "sam", ownCents: 25_000 },
    ]);
    expect(buckets.mortgage.lead).toEqual({ personId: "alex", byCents: 69_999 });
    expect(buckets.mortgage.balanceCents).toBe(119_999);
    expect(buckets.buffer.balanceCents).toBe(40_500);
    expect(buckets.unclassified).toBe(0);

    // Imported, not pasted; the year's own, repaired date; the workbook's note.
    expect(db.prepare("SELECT source, imported_by FROM statement_imports").all()).toEqual([
      { source: "workbook", imported_by: "alex" },
    ]);
    expect(db.prepare("SELECT date FROM statement_rows WHERE date LIKE '%-06-15'").all()).toEqual([
      { date: "2022-06-15" },
    ]);
    expect(db.prepare("SELECT note FROM statement_rows WHERE date = '2022-09-10'").get()).toEqual({
      note: "Équivalence avril - août",
    });
    db.close();
  });

  test("a correction moves its row and leaves a note on it", async () => {
    const corrections = path.join(dir, "corrections.json");
    writeFileSync(
      corrections,
      JSON.stringify({
        corrections: [
          { sheet: "2023", row: 3, bucket: "current-expenses", note: "Meant for the buffer." },
        ],
      }),
    );

    const ran = await run(
      await workbook(),
      "--as",
      "sam",
      "--corrections",
      "corrections.json",
      "--write",
    );

    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toMatch(/corrected +1\n/u);
    const db = books();
    const row = db
      .prepare("SELECT id, note FROM statement_rows WHERE date = '2023-03-01'")
      .get() as { id: number; note: string };
    expect(row.note).toBe("Corrected on import from mortgage, sam: Meant for the buffer.");
    // What the workbook said stays; the correction is the record that stands.
    expect(
      db
        .prepare("SELECT bucket, person_id FROM classifications WHERE row_id = ? ORDER BY id")
        .all(row.id),
    ).toEqual([
      { bucket: "mortgage", person_id: "sam" },
      { bucket: "current-expenses", person_id: "sam" },
    ]);
    const buckets = bucketsAsOf(db, "2024-12-31");
    expect(buckets.buffer.balanceCents).toBe(70_500);
    expect(buckets.mortgage.own).toEqual([
      { personId: "alex", ownCents: 94_999 },
      { personId: "sam", ownCents: -5_000 },
    ]);
    db.close();
  });

  test("imported period settlements keep their historical amounts and formula version", async () => {
    const ran = await run(await workbook(), "--as", "alex", "--write");

    expect(ran.code, ran.out).toBe(0);
    const db = books();
    const periods = closedPeriods(db);
    expect(
      periods.map((period) => ({
        start: period.start,
        end: period.end,
        formula: period.settlement.formula,
        payerId: period.settlement.payerId,
        recipientId: period.settlement.recipientId,
        depositCents: period.settlement.depositCents,
        status: period.deposit.status,
      })),
    ).toEqual([
      {
        start: "2022-09-01",
        end: "2023-03-31",
        formula: "v2",
        payerId: "sam",
        recipientId: "alex",
        depositCents: 10_000,
        status: "matched",
      },
      {
        start: "2022-04-01",
        end: "2022-08-31",
        formula: "v1",
        payerId: "alex",
        recipientId: "sam",
        depositCents: 38_000,
        status: "matched",
      },
    ]);

    // Accueil's salaries, and the ratio from them, from the start of the history.
    expect(
      currentSalaries(db).map((salary) => [salary.personId, salary.year, salary.amountCents]),
    ).toEqual([
      ["alex", 2022, 6_000_000],
      ["sam", 2022, 4_000_000],
    ]);
    expect(
      currentRatios(db).map((ratio) => [
        ratio.effectiveFrom,
        ratio.shares.map((share) => share.partsPerMillion),
      ]),
    ).toEqual([["2022-01-05", [600_000, 400_000]]]);

    // Each sheet's lines, dated on its last day; the open sheet's from the day after the last close.
    expect(
      currentLines(db).map((line) => [
        line.date,
        line.personId,
        line.amountCents,
        line.category,
        line.source,
      ]),
    ).toEqual([
      ["2022-08-31", "sam", 10_000, "Épicerie", "workbook"],
      ["2022-08-31", "sam", 20_000, "Internet", "workbook"],
      ["2022-08-31", "alex", 12_000, "Quincaillerie", "workbook"],
      ["2023-03-31", "alex", 40_000, "Épicerie", "workbook"],
      ["2023-03-31", "sam", 10_000, "Pharmacie", "workbook"],
      ["2023-04-01", "alex", 9_000, "Épicerie", "workbook"],
      ["2023-04-01", "sam", 3_000, "Restaurant", "workbook"],
    ]);

    // The catch-up, through openPeriod, beside the open sheet's own figure:
    // v1 asked alex 50.00 too much and v2 asked sam 66.67 too little.
    expect(ran.out).toContain(
      "books (cumulative, the catch-up folded in): sam deposits 130.00 $ (net 78.00 $), v3",
    );
    expect(ran.out).toContain("this period alone, v2): sam deposits 18.00 $");
    db.close();
  });
});

describe("the workbook against the rows already pasted", () => {
  /** The workbook's last three rows as AccèsD pasted them, with the bank's own descriptions. */
  function pasteTail(
    db: Database.Database,
    change: { date?: string; balanceCents?: number } = {},
  ): void {
    const rows = withBalances(
      [
        {
          date: "2024-01-05",
          description: "Virement entre folios /Caisse du Lac",
          amountCents: 50_000,
        },
        {
          date: change.date ?? "2024-01-20",
          description: "Hypothèque /Prêteur Exemple",
          amountCents: -70_000,
        },
        { date: "2024-02-02", description: "Achat /Quincaillerie Exemple", amountCents: -30_000 },
      ],
      // What the workbook's account held at the end of 2023.
      change.balanceCents ?? 210_499,
    );
    const context = { db, personId: "alex", now: () => NOW };
    importStatement(context, renderPaste(rows));
    const ids = (
      db.prepare("SELECT id FROM statement_rows ORDER BY seq").all() as { id: number }[]
    ).map((row) => row.id);
    const filing = [
      { personId: "alex", bucket: "mortgage" },
      { personId: null, bucket: "mortgage" },
      { personId: null, bucket: "current-expenses" },
    ] as const;
    const classify = { ...context, people: new Set(["alex", "sam"]) };
    for (const [index, rowId] of ids.entries()) {
      const answer = filing[index];
      if (answer !== undefined) classifyRow(classify, { rowId, ...answer });
    }
  }

  test("the rows a paste holds are checked, not imported, and the rest go below them", async () => {
    const db = books();
    enrollPeople(db, ["alex", "sam"], NOW);
    pasteTail(db, { date: "2024-01-21" });
    db.close();

    const ran = await run(await workbook(), "--as", "alex", "--write");

    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toMatch(/imported +14\n/u);
    expect(ran.out).toMatch(/already stored +3 /u);
    expect(ran.out).toContain("dated differently: 2024 row 3, 2024-01-20");
    const after = books();
    const rows = after
      .prepare("SELECT seq, date, description, import_id FROM statement_rows ORDER BY seq")
      .all() as { seq: number; date: string; description: string; import_id: number }[];
    expect(rows).toHaveLength(17);
    expect(rows[0]?.seq).toBe(-14);
    // The pasted rows keep their place, their date and the bank's words.
    expect(
      rows.slice(14).map((row) => [row.seq, row.date, row.description, row.import_id]),
    ).toEqual([
      [0, "2024-01-05", "Virement entre folios /Caisse du Lac", 1],
      [1, "2024-01-21", "Hypothèque /Prêteur Exemple", 1],
      [2, "2024-02-02", "Achat /Quincaillerie Exemple", 1],
    ]);
    expect(bucketsAsOf(after, "2024-12-31").buffer.balanceCents).toBe(40_500);
    after.close();
  });

  test("a stored row whose balance disagrees with the workbook's is refused, and nothing is written", async () => {
    const db = books();
    enrollPeople(db, ["alex", "sam"], NOW);
    pasteTail(db, { balanceCents: 210_500 });
    const before = dump(db);
    db.close();

    const ran = await run(await workbook(), "--as", "alex", "--write");

    expect(ran.code, ran.err).toBe(1);
    expect(ran.out).toContain(
      '2024 row 4, 2024-01-05 "Versement" 500.00 $ (balance 2604.99 $) moves the same day and amount as the oldest stored row, but leaves 2604.99 $ where it leaves 2605.00 $',
    );
    const after = books();
    expect(dump(after)).toEqual(before);
    after.close();
  });

  test("a workbook that fits the stored rows two ways is refused rather than guessed at", async () => {
    // A transfer, its return and the transfer again, at the end of the workbook
    // and stored: the last row alone fits the oldest stored one as well as all three do.
    const fixture = history();
    const year = fixture.years[2];
    if (year === undefined) throw new Error("the fixture has no 2024");
    year.rows.push(
      {
        written: "2024-03-01",
        bucket: "Dép. Courantes",
        detail: "Virement",
        person: "Sam",
        amount: 10,
      },
      {
        written: "2024-03-01",
        bucket: "Dép. Courantes",
        detail: "Retour",
        person: "Sam",
        amount: -10,
      },
      {
        written: "2024-03-01",
        bucket: "Dép. Courantes",
        detail: "Virement",
        person: "Sam",
        amount: 10,
      },
    );
    const db = books();
    enrollPeople(db, ["alex", "sam"], NOW);
    const rows = withBalances(
      [
        { date: "2024-03-01", description: "Virement /Caisse du Mont", amountCents: 1_000 },
        { date: "2024-03-01", description: "Retour /Caisse du Mont", amountCents: -1_000 },
        { date: "2024-03-01", description: "Virement /Caisse du Mont", amountCents: 1_000 },
      ],
      160_499,
    );
    importStatement({ db, personId: "alex", now: () => NOW }, renderPaste(rows));
    db.close();

    const ran = await run(await workbook(fixture), "--as", "alex");

    expect(ran.code, ran.err).toBe(1);
    expect(ran.out).toContain("can be placed against the stored rows 2 ways");
  });

  test("the command names what it needs before it reads anything", async () => {
    const ran = await run(await workbook());

    expect(ran.code).toBe(2);
    expect(ran.err).toContain("--as");
    expect(existsSync(databasePath)).toBe(false);
  });
});
