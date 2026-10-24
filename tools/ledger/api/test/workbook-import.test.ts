/**
 * The workbook import (lg-7), through the command: a synthetic workbook built
 * by the test (`helpers/workbook.ts`), imported into a database file, and the
 * books read back. Every name, description and amount is invented.
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { householdBooksPath } from "../src/books.ts";
import { bucketsAsOf } from "../src/buckets.ts";
import { classifyRow } from "../src/classifications.ts";
import { migrate } from "../src/db/schema.ts";
import { Directory } from "../src/directory.ts";
import { runImportCommand } from "../src/import-command.ts";
import { enrollPeople } from "../src/people.ts";
import { closedPeriods, currentLines } from "../src/periods.ts";
import { currentRatios, currentSalaries } from "../src/salaries.ts";
import { importStatement } from "../src/statements.ts";
import { HOUSEHOLD, writeMemberDirectory } from "./helpers/access.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import { asTwo } from "./helpers/settlement.ts";
import { history, render } from "./helpers/workbook.ts";
import type { Fixture } from "./helpers/workbook.ts";

const NOW = new Date("2026-10-07T12:00:00.000Z");

let dir: string;
/** `DATABASE_PATH`: the directory the books are kept in (lg-21). */
let dataDir: string;
/** The test household's books file in it, the one the import writes. */
let databasePath: string;
let directoryPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ledger-workbook-"));
  dataDir = path.join(dir, "books");
  databasePath = householdBooksPath(dataDir, HOUSEHOLD);
  // Outside the books' directory, so a test can still see that a refused
  // import leaves no books directory behind.
  directoryPath = path.join(dir, "directory.db");
  writeMemberDirectory(directoryPath);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Ran {
  code: number;
  out: string;
  err: string;
}

/** The command, for the test household unless the arguments name one (lg-21). */
async function run(...args: string[]): Promise<Ran> {
  let out = "";
  let err = "";
  const argv = args.includes("--household") ? args : [...args, "--household", HOUSEHOLD];
  const code = await runImportCommand(argv, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    env: { DATABASE_PATH: dataDir, DIRECTORY_PATH: directoryPath },
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
        payerId: asTwo(period.settlement).payerId,
        recipientId: asTwo(period.settlement).recipientId,
        depositCents: asTwo(period.settlement).depositCents,
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

  test("a period given its own ratio records it, and its settlement and the catch-up use it", async () => {
    writeFileSync(
      path.join(dir, "corrections.json"),
      JSON.stringify({ ratios: [{ sheet: "$ (Sept-Mars)", shares: { Alex: 50, Sam: 50 } }] }),
    );

    const ran = await run(
      await workbook(),
      "--as",
      "alex",
      "--corrections",
      "corrections.json",
      "--write",
    );

    expect(ran.code, ran.out).toBe(0);
    const db = books();
    expect(
      closedPeriods(db).map((period) => [
        period.end,
        period.settlement.formula,
        asTwo(period.settlement).depositCents,
        period.settlement.shares.map((share) => share.partsPerMillion),
      ]),
    ).toEqual([
      ["2023-03-31", "v2", 10_000, [500_000, 500_000]],
      ["2022-08-31", "v1", 38_000, [600_000, 400_000]],
    ]);
    // Each ratio takes effect at a period boundary: Accueil's, the period's own
    // from the day after the close before it, and Accueil's again after it.
    expect(
      currentRatios(db).map((ratio) => [
        ratio.effectiveFrom,
        ratio.shares.map((share) => [share.partsPerMillion, share.salaryId === null]),
      ]),
    ).toEqual([
      [
        "2022-01-05",
        [
          [600_000, false],
          [400_000, false],
        ],
      ],
      [
        "2022-09-01",
        [
          [500_000, true],
          [500_000, true],
        ],
      ],
      [
        "2023-04-01",
        [
          [600_000, false],
          [400_000, false],
        ],
      ],
    ]);
    // At 0.5, period 2 leaves sam owing 100.00 rather than 40.00; with period
    // 1's 20.00 and the open period's 18.00 that is 138.00, deposited at 0.6.
    expect(ran.out).toContain(
      "books (cumulative, the catch-up folded in): sam deposits 230.00 $ (net 138.00 $), v3",
    );
    expect(ran.out).toContain("settled at alex 50.0000 %, sam 50.0000 %");
    db.close();
  });

  test("a ratio that is malformed, or names no closed period, is refused naming its entry", async () => {
    const file = path.join(dir, "corrections.json");
    writeFileSync(
      file,
      JSON.stringify({ ratios: [{ sheet: "$ (Sept-Mars)", shares: { Alex: 50, Sam: 40 } }] }),
    );
    const malformed = await run(
      await workbook(),
      "--as",
      "alex",
      "--corrections",
      "corrections.json",
    );
    writeFileSync(
      file,
      JSON.stringify({
        ratios: [
          { sheet: "$ (Nulle part)", shares: { Alex: 50, Sam: 50 } },
          { sheet: "$ (Avril - …)", shares: { Alex: 50, Sam: 50 } },
        ],
      }),
    );
    const nowhere = await run(
      await workbook(),
      "--as",
      "alex",
      "--corrections",
      "corrections.json",
    );

    expect(malformed.code).toBe(2);
    expect(malformed.err).toContain("ratio 1's shares add up to 90 %, not 100 %.");
    expect(nowhere.code).toBe(1);
    expect(nowhere.out).toContain(
      `The corrections file's ratio 1, for "$ (Nulle part)", names no closed period sheet of the workbook.`,
    );
    expect(nowhere.out).toContain(
      `The corrections file's ratio 2, for "$ (Avril - …)", names the open period`,
    );
  });

  test("a refused --write leaves books at an older schema version as they were, and so does a dry run", async () => {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const old = new Database(databasePath);
    migrate(old, 4);
    enrollPeople(old, ["alex", "sam"], NOW);
    old.close();
    const hash = sha256(databasePath);
    const fixture = history();
    const year = fixture.years[1];
    if (year === undefined) throw new Error("the fixture has no 2023");
    year.carry.buffer = 579;

    const dry = await run(await workbook(), "--as", "alex");
    const refused = await run(await workbook(fixture), "--as", "alex", "--write");

    expect(dry.code, dry.out).toBe(0);
    expect(refused.code, refused.err).toBe(1);
    expect(sha256(databasePath)).toBe(hash);
    expect(readdirSync(path.dirname(databasePath))).toEqual([path.basename(databasePath)]);
  });

  test("a refused --write into books that do not exist leaves no file", async () => {
    const fixture = history();
    const year = fixture.years[1];
    if (year === undefined) throw new Error("the fixture has no 2023");
    year.carry.buffer = 579;

    const ran = await run(await workbook(fixture), "--as", "alex", "--write");

    expect(ran.code, ran.err).toBe(1);
    expect(existsSync(path.dirname(databasePath))).toBe(false);
  });
});

describe("the workbook against the rows already pasted", () => {
  /** The workbook's last three rows as AccèsD pasted them, with the bank's own descriptions. */
  function pasteTail(
    db: Database.Database,
    change: { date?: string; newest?: string; balanceCents?: number } = {},
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
        {
          date: change.newest ?? "2024-02-02",
          description: "Achat /Quincaillerie Exemple",
          amountCents: -30_000,
        },
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

  test("a dry run never opens the books: a crash image's file and log stay as they were, and nothing appears beside them", async () => {
    // What an unclean stop of the API leaves: the file, and a log holding
    // rows the file does not have yet, with no shared-memory file.
    const live = books();
    enrollPeople(live, ["alex", "sam"], NOW);
    pasteTail(live);
    dataDir = path.join(dir, "crash");
    const crash = path.dirname(householdBooksPath(dataDir, HOUSEHOLD));
    mkdirSync(crash, { recursive: true });
    copyFileSync(databasePath, householdBooksPath(dataDir, HOUSEHOLD));
    copyFileSync(`${databasePath}-wal`, `${householdBooksPath(dataDir, HOUSEHOLD)}-wal`);
    live.close();
    databasePath = householdBooksPath(dataDir, HOUSEHOLD);
    const before = {
      file: sha256(databasePath),
      log: sha256(`${databasePath}-wal`),
      entries: readdirSync(crash),
    };
    expect(before.entries).toEqual(["home.db", "home.db-wal"]);

    const ran = await run(await workbook(), "--as", "alex");

    expect(ran.code, ran.out).toBe(0);
    // The rows only the log held were read.
    expect(ran.out).toMatch(/already stored +3 /u);
    expect({
      file: sha256(databasePath),
      log: sha256(`${databasePath}-wal`),
      entries: readdirSync(crash),
    }).toEqual(before);
  });

  test("a workbook that fits two ways is refused even when one way runs past the stored rows", async () => {
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
    // Two rows stored: they are the tail's first two (the workbook one row
    // ahead of the paste), or they follow its last row. Either fits.
    const rows = withBalances(
      [
        { date: "2024-03-01", description: "Virement /Caisse du Mont", amountCents: 1_000 },
        { date: "2024-03-01", description: "Retour /Caisse du Mont", amountCents: -1_000 },
      ],
      160_499,
    );
    importStatement({ db, personId: "alex", now: () => NOW }, renderPaste(rows));
    db.close();

    const ran = await run(await workbook(fixture), "--as", "alex", "--write");

    expect(ran.code, ran.err).toBe(1);
    expect(ran.out).toContain("can be placed against the stored rows 2 ways");
  });

  test("a stored newest row dated a day after the workbook's copy of it is reported, not refused", async () => {
    const db = books();
    enrollPeople(db, ["alex", "sam"], NOW);
    pasteTail(db, { newest: "2024-02-03" });
    db.close();

    const ran = await run(await workbook(), "--as", "alex", "--write");

    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain("dated differently: 2024 row 2, 2024-02-02");
    expect(ran.out).toContain("The books show the workbook's figures for both buckets.");
  });

  test("a correction naming a row a paste already holds is refused, naming the row", async () => {
    const db = books();
    enrollPeople(db, ["alex", "sam"], NOW);
    pasteTail(db);
    db.close();
    writeFileSync(
      path.join(dir, "corrections.json"),
      JSON.stringify({
        corrections: [
          { sheet: "2024", row: 4, bucket: "current-expenses", note: "Meant for the buffer." },
        ],
      }),
    );

    const ran = await run(
      await workbook(),
      "--as",
      "alex",
      "--corrections",
      "corrections.json",
      "--write",
    );

    expect(ran.code, ran.err).toBe(1);
    expect(ran.out).toContain(
      "The correction for 2024 row 4 names a row a paste already holds, 2024-01-05",
    );
    expect(ran.out).toContain("File that row in the app");
  });

  test("a stored row the workbook lacks is named as a row in one and not the other, not as 0.00 unexplained", async () => {
    const db = books();
    enrollPeople(db, ["alex", "sam"], NOW);
    const rows = withBalances(
      [
        {
          date: "2024-01-05",
          description: "Virement entre folios /Caisse du Lac",
          amountCents: 50_000,
        },
        { date: "2024-01-10", description: "Remise /Caisse du Lac", amountCents: 100 },
        { date: "2024-01-20", description: "Hypothèque /Prêteur Exemple", amountCents: -70_000 },
      ],
      210_499,
    );
    importStatement({ db, personId: "alex", now: () => NOW }, renderPaste(rows));
    db.close();

    const ran = await run(await workbook(), "--as", "alex");

    expect(ran.code).toBe(1);
    expect(ran.out).toContain("so a row is in one and not the other.");
    expect(ran.out).not.toContain("0.00 $ is unexplained");
  });

  test("a read-only books file dry-runs, refuses --write, and keeps its mode", async () => {
    const db = books();
    enrollPeople(db, ["alex", "sam"], NOW);
    db.close();
    chmodSync(databasePath, 0o444);
    const mode = statSync(databasePath).mode;
    const hash = sha256(databasePath);

    const dry = await run(await workbook(), "--as", "alex");
    const written = await run(await workbook(), "--as", "alex", "--write");

    expect(dry.code, dry.err).toBe(0);
    expect(written.code).not.toBe(0);
    expect(statSync(databasePath).mode).toBe(mode);
    expect(sha256(databasePath)).toBe(hash);
    chmodSync(databasePath, 0o644);
  });

  test("a formula saved as 0 is a placeholder's amount, or a carry-over of nothing, not an unreadable cell", async () => {
    const fixture = history();
    const [first] = fixture.years;
    if (first === undefined) throw new Error("the fixture has no 2022");
    const placeholder = first.rows[6];
    if (placeholder?.amount !== undefined) throw new Error("row 7 of 2022 is the placeholder");
    if (placeholder !== undefined) placeholder.amountFormula = "0*1";
    first.carryFormula = { buffer: "0*1" };

    const ran = await run(await workbook(fixture), "--as", "alex");

    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain("skipped: 2022 row 4, no amount");
  });

  test("a date a few days off, with no year repaired, is reported and imported as typed", async () => {
    const fixture = history();
    const row = fixture.years[2]?.rows[0];
    if (row === undefined) throw new Error("the fixture has no 2024");
    row.written = "2024-01-25";

    const ran = await run(await workbook(fixture), "--as", "alex", "--write");

    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain(
      "dated out of order: 2024 row 3, 2024-01-20, is listed above row 4, 2024-01-25; imported as typed",
    );
    const db = books();
    expect(
      db
        .prepare(
          "SELECT date FROM statement_rows WHERE amount_cents = 50000 AND date LIKE '2024-%'",
        )
        .all(),
    ).toEqual([{ date: "2024-01-25" }]);
    db.close();
  });
});

describe("--as resolves against the household directory (lg-20)", () => {
  test("a name no member stands under is refused before anything is read", async () => {
    const ran = await run(await workbook(), "--as", "casey", "--write");

    expect(ran.code).toBe(2);
    expect(ran.err).toContain('--as names "casey", who is not a member');
    expect(ran.err).toContain("alex, sam");
    expect(existsSync(databasePath)).toBe(false);
  });

  test("a directory that is not there is refused rather than created", async () => {
    rmSync(directoryPath);

    const ran = await run(await workbook(), "--as", "alex");

    expect(ran.code).toBe(2);
    expect(ran.err).toContain("household:ledger");
    expect(existsSync(directoryPath)).toBe(false);
  });
});

// lg-21: each household has books of its own, and the import writes one
// household's, named on the command line, and no other's.
describe("--household names the books the import writes (lg-21)", () => {
  const AWAY = "away";

  /** A second household, kim and alex, beside the test one, with books of its own. */
  function secondHousehold(): Database.Database {
    const directory = Directory.open(directoryPath);
    const change = { by: "operator", at: NOW };
    directory.addHousehold({ id: AWAY, name: "The other household", ...change });
    directory.addMember({ household: AWAY, address: "kim@example.test", person: "kim", ...change });
    directory.addMember({ household: AWAY, address: "alex@away.test", person: "alex", ...change });
    directory.close();
    const file = householdBooksPath(dataDir, AWAY);
    mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    migrate(db);
    enrollPeople(db, ["alex", "kim"], NOW);
    db.pragma("wal_checkpoint(TRUNCATE)");
    return db;
  }

  test("a --write goes to the named household's file, and the other's is not touched", async () => {
    const away = secondHousehold();
    const before = dump(away);
    away.close();
    const hash = sha256(householdBooksPath(dataDir, AWAY));

    const ran = await run(await workbook(), "--household", HOUSEHOLD, "--as", "alex", "--write");

    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain(`Household: ${HOUSEHOLD}`);
    const home = books();
    expect(home.prepare("SELECT count(*) AS n FROM statement_rows").get()).toEqual({ n: 17 });
    home.close();
    expect(sha256(householdBooksPath(dataDir, AWAY))).toBe(hash);
    const after = new Database(householdBooksPath(dataDir, AWAY), { readonly: true });
    expect(dump(after)).toEqual(before);
    expect(after.prepare("SELECT count(*) AS n FROM statement_rows").get()).toEqual({ n: 0 });
    after.close();
  });

  test("--as is one of the named household's own members", async () => {
    secondHousehold().close();

    const ran = await run(await workbook(), "--household", AWAY, "--as", "sam");

    expect(ran.code).toBe(2);
    expect(ran.err).toContain(`--as names "sam", who is not a member of ${AWAY}`);
    expect(ran.err).toContain("alex, kim");
  });

  test("a household the directory does not hold, or an id that is not a word, is refused and creates nothing", async () => {
    for (const household of ["nowhere", "../home", "Home", ""]) {
      const ran = await run(await workbook(), "--household", household, "--as", "alex", "--write");

      expect(ran.code, household).toBe(2);
      expect(ran.err, household).toMatch(/--household/u);
    }
    expect(existsSync(dataDir)).toBe(false);
  });

  test("each closed period's deposit is reported as paid, or as not found, and never refuses", async () => {
    const paid = await run(await workbook(), "--as", "alex");

    expect(paid.code, paid.out).toBe(0);
    expect(paid.out).toMatch(
      /paid: \$ \(Avril-Août\)'s 380\.00 \$ by alex, 2022 row \d+, 2022-09-10/u,
    );
    expect(paid.out).toMatch(
      /paid: \$ \(Sept-Mars\)'s 100\.00 \$ by sam, 2023 row \d+, 2023-04-10/u,
    );

    // Paid net of something: the sheet asked for 100.00, the account holds 90.00.
    const fixture = history();
    const deposit = fixture.years[1]?.rows.find((row) => row.detail === "Équivalence");
    if (deposit === undefined) throw new Error("the fixture has no 2023 deposit");
    deposit.amount = 90;
    const next = fixture.years[2];
    if (next === undefined) throw new Error("the fixture has no 2024");
    next.carry.buffer -= 10;
    const net = await run(await workbook(fixture), "--as", "alex");

    expect(net.code, net.out).toBe(0);
    expect(net.out).toContain(
      "not paid in the workbook: $ (Sept-Mars) asked sam for 100.00 $, and no deposit of that amount by sam is in the year sheets from 2023-03-17; check it before --write",
    );
  });
});

// lg-40, Build item 5: the paste meets the workbook's rows the same way both
// ways round, so a day the workbook lists in another order than the bank is
// placed when the pastes came first, too.

/** The workbook's 2024 with one more day, of three movements, in the workbook's order. */
function withDay(): Fixture {
  const fixture = history();
  const year = fixture.years[2];
  if (year === undefined) throw new Error("the fixture has no 2024");
  year.rows.push(
    {
      written: "2024-03-01",
      bucket: "Dép. Courantes",
      detail: "Versement",
      person: "Sam",
      amount: 10,
    },
    {
      written: "2024-03-01",
      bucket: "Dép. Courantes",
      detail: "Versement",
      person: "Alex",
      amount: 5,
    },
    { written: "2024-03-01", bucket: "Dép. Courantes", detail: "Achat", amount: -20 },
  );
  return fixture;
}

describe("the workbook against pasted rows that list a day in another order (lg-40)", () => {
  /** The same day as the bank lists it, −20, +10, +5, stored and filed as the workbook files it. */
  function pasteDay(
    db: Database.Database,
    amounts: readonly number[] = [-2_000, 1_000, 500],
    lastDate = "2024-03-01",
  ): void {
    const words: Record<number, string> = {
      [-2_000]: "Achat /Quincaillerie Exemple",
      1_000: "Virement /Caisse du Mont",
      500: "Virement /Caisse du Lac",
    };
    const rows = withBalances(
      amounts.map((amountCents, index) => ({
        date: index === amounts.length - 1 ? lastDate : "2024-03-01",
        description: words[amountCents] ?? "Autre",
        amountCents,
      })),
      // What the workbook's account held after its 2024-02-02 row.
      160_499,
    );
    const context = { db, personId: "alex", now: () => NOW };
    importStatement(context, renderPaste(rows));
    const filed = (
      db.prepare("SELECT id, amount_cents FROM statement_rows ORDER BY seq").all() as {
        id: number;
        amount_cents: number;
      }[]
    ).map((row) => ({
      rowId: row.id,
      bucket: "current-expenses" as const,
      personId: row.amount_cents === 1_000 ? "sam" : row.amount_cents === 500 ? "alex" : null,
    }));
    const classify = { ...context, people: new Set(["alex", "sam"]) };
    for (const answer of filed) classifyRow(classify, answer);
  }

  test("the stored day is the workbook's newest, in another order, and only the older rows are imported", async () => {
    const db = books();
    enrollPeople(db, ["alex", "sam"], NOW);
    pasteDay(db);
    db.close();

    const ran = await run(await workbook(withDay()), "--as", "alex", "--write");

    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toMatch(/imported +17\n/u);
    expect(ran.out).toMatch(/already stored +3 /u);
    expect(ran.out).toContain("The books show the workbook's figures for both buckets.");
    const after = books();
    // The pasted rows keep the bank's order and words.
    expect(
      (
        after
          .prepare(
            "SELECT seq, description, amount_cents FROM statement_rows WHERE seq >= 0 ORDER BY seq",
          )
          .all() as { seq: number; description: string; amount_cents: number }[]
      ).map((row) => [row.seq, row.description, row.amount_cents]),
    ).toEqual([
      [0, "Achat /Quincaillerie Exemple", -2_000],
      [1, "Virement /Caisse du Mont", 1_000],
      [2, "Virement /Caisse du Lac", 500],
    ]);
    after.close();
  });

  test("a stored day whose amounts differ by one row, ending on the same balance, is still refused", async () => {
    const db = books();
    enrollPeople(db, ["alex", "sam"], NOW);
    // −20, +11, +4: the day ends on the workbook's balance, but is not its day.
    pasteDay(db, [-2_000, 1_100, 400]);
    const before = dump(db);
    db.close();

    const ran = await run(await workbook(withDay()), "--as", "alex", "--write");

    expect(ran.code, ran.out).toBe(1);
    expect(ran.out).toContain("Refused: nothing was written.");
    const after = books();
    expect(dump(after)).toEqual(before);
    after.close();
  });

  test("a date that differs within a reordered day is reported against the row's own match, not the row in its place", async () => {
    const db = books();
    enrollPeople(db, ["alex", "sam"], NOW);
    // The bank dates its last row of the day, the +5, the 2nd. In the workbook
    // the +5 is the day's second row and the −20 its last.
    pasteDay(db, undefined, "2024-03-02");
    db.close();

    const ran = await run(await workbook(withDay()), "--as", "alex");

    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain(
      'dated differently: 2024 row 3, 2024-03-01 "Versement" 5.00 $ (balance 1619.99 $); the paste says 2024-03-02',
    );
    expect(ran.out).not.toContain('"Achat" -20.00 $ (balance 1599.99 $); the paste says');
  });

  test("the report and the refusal say the rows are compared day by day (gate 1, F6)", async () => {
    const db = books();
    enrollPeople(db, ["alex", "sam"], NOW);
    pasteDay(db);
    db.close();

    const placed = await run(await workbook(withDay()), "--as", "alex");

    expect(placed.code, placed.out).toBe(0);
    expect(placed.out).toContain(
      "The 3 rows the pastes already hold are the workbook's newest, day by day, by amount and balance.",
    );

    // A stored row the workbook lacks: nothing lines up from the oldest.
    for (const file of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      rmSync(file, { force: true });
    }
    const other = books();
    enrollPeople(other, ["alex", "sam"], NOW);
    importStatement(
      { db: other, personId: "alex", now: () => NOW },
      renderPaste(
        withBalances(
          [
            { date: "2024-01-05", description: "Virement /Caisse du Lac", amountCents: 50_000 },
            { date: "2024-01-10", description: "Remise /Caisse du Lac", amountCents: 100 },
          ],
          210_499,
        ),
      ),
    );
    other.close();

    const refused = await run(await workbook(), "--as", "alex");

    expect(refused.code).toBe(1);
    expect(refused.out).toContain(
      ", day by day by amount and balance, so a row is in one and not the other.",
    );
    expect(refused.out).not.toContain("one for one");
  });
});

/** The history with 2022's first row's detail cell holding `detail` (lg-68). */
function withDetail(detail: string | number): Fixture {
  const fixture = history();
  const row = fixture.years[0]?.rows[0];
  if (row === undefined) throw new Error("the fixture has no 2022 row");
  row.detail = detail;
  return fixture;
}

describe("a detail cell that holds a number (lg-68)", () => {
  function stored(): unknown {
    const db = books();
    const rows = db
      .prepare("SELECT description FROM statement_rows WHERE date = '2022-01-05'")
      .all();
    db.close();
    return rows;
  }

  test("is stored as the number's text, not as an empty description", async () => {
    const ran = await run(await workbook(withDetail(42)), "--as", "alex", "--write");

    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toMatch(/imported +17\n/u);
    expect(stored()).toEqual([{ description: "42" }]);
  });

  test("a re-import onto books that already hold the import is refused, whatever the detail", async () => {
    // An empty detail stores what the defect stored for a number: "".
    expect((await run(await workbook(withDetail("")), "--as", "alex", "--write")).code).toBe(0);
    const db = books();
    db.pragma("wal_checkpoint(TRUNCATE)");
    const before = dump(db);
    db.close();

    const again = await run(await workbook(withDetail(42)), "--as", "alex", "--write");

    expect(again.code).toBe(1);
    expect(again.out).toContain(
      "The books already hold 2 closed periods. The workbook's are their first record, so it is imported into books that hold none.",
    );
    expect(again.out).toContain("Refused: nothing was written.");
    const after = books();
    expect(dump(after)).toEqual(before);
    after.close();
    expect(stored()).toEqual([{ description: "" }]);
  });
});
