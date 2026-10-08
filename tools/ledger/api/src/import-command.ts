/**
 * `npm run import:ledger -- <workbook.xlsx> --as <person> [--corrections <file.json>] [--write]`
 * (lg-7).
 *
 * A command and not a route: the import is a one-off, run by the owner on the
 * machine that holds the database, and has no reason to exist on the network.
 * It writes to the database the API is configured with (`DATABASE_PATH`).
 *
 * **A dry run never opens that file.** The file and its write-ahead log are
 * copied, byte for byte, into a private directory, and the import is done on
 * the copy, which is then deleted. Opening the original, even only to read it,
 * is a write in SQLite's terms: a log left by an unclean stop is recovered into
 * the file on close, and a missing shared-memory file is created beside it.
 *
 * **`--write` rehearses first.** The same import runs on a copy, and only when
 * every verification holds there is the real file opened, created if need be,
 * and migrated and imported in one transaction that the import verifies again
 * before it commits. A refused `--write` therefore leaves the books as they were
 * — their schema version included — or leaves no file where there was none.
 *
 * Exit status: 0 when every verification holds, 1 when one fails (nothing is
 * written), 2 when the command could not run at all.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { readCorrections, NO_CORRECTIONS } from "@ledger/books";
import type { Corrections } from "@ledger/books";
import { AppError } from "@ledger/contract";
import Database from "better-sqlite3";
import { loadApiConfig } from "./config.ts";
import { configure } from "./db/schema.ts";
import { configuredPeople } from "./people.ts";
import { importWorkbook } from "./workbook-import.ts";
import { readSheets } from "./xlsx.ts";

export interface CommandIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  /** Where relative paths on the command line are resolved from. */
  cwd: string;
  now: () => Date;
}

const USAGE = `Usage: npm run import:ledger -- <workbook.xlsx> --as <person> [--corrections <file.json>] [--write]

Imports the household's old workbook into the ledger's database (DATABASE_PATH).
Without --write it is a dry run: the report is printed and nothing is written.
  --as           the person the import is recorded under, as ACCESS_PEOPLE names them
  --corrections  the owner's corrections, a JSON file kept outside the repository
  --write        perform the import, if every verification holds
`;

function usage(io: CommandIo, message: string): number {
  io.stderr(`${message}\n\n${USAGE}`);
  return 2;
}

/**
 * A private copy of the books: the file and, when there is one, its
 * write-ahead log, read and never opened. `undefined` when there are no books
 * yet, which a dry run reads as empty ones. The copy is taken while the API
 * may be writing; a copy torn by a checkpoint between the two reads can only
 * make the rehearsal differ from the real import, which verifies everything
 * again on the real file before it commits.
 */
function copyBooks(databasePath: string, into: string): string | undefined {
  if (databasePath === ":memory:" || !existsSync(databasePath)) return undefined;
  const copy = path.join(into, "ledger.db");
  copyFileSync(databasePath, copy);
  if (existsSync(`${databasePath}-wal`)) copyFileSync(`${databasePath}-wal`, `${copy}-wal`);
  return copy;
}

function openCopy(copy: string | undefined): Database.Database {
  const db = new Database(copy ?? ":memory:");
  configure(db);
  return db;
}

function openReal(databasePath: string): Database.Database {
  if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  configure(db);
  return db;
}

function loadCorrections(file: string): Corrections {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error: unknown) {
    throw new AppError("BAD_REQUEST", `The corrections file ${file} could not be read.`, {
      cause: error,
    });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error: unknown) {
    throw new AppError("BAD_REQUEST", `The corrections file ${file} is not JSON.`, {
      cause: error,
    });
  }
  return readCorrections(json);
}

export async function runImportCommand(argv: readonly string[], io: CommandIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        write: { type: "boolean", default: false },
        corrections: { type: "string" },
        as: { type: "string" },
        help: { type: "boolean", default: false },
      },
    });
  } catch (error: unknown) {
    return usage(io, error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(USAGE);
    return 0;
  }
  const [workbookArg, ...extra] = positionals;
  if (workbookArg === undefined || extra.length > 0) return usage(io, "Name exactly one workbook.");
  const personId = values.as?.trim();
  if (personId === undefined || personId === "") {
    return usage(io, "Name the person the import is recorded under, with --as.");
  }

  try {
    const config = loadApiConfig({}, io.env);
    if (values.write && config.databasePath === ":memory:") {
      return usage(
        io,
        "DATABASE_PATH is :memory:, which nothing outlives; name the database file.",
      );
    }
    const workbookPath = path.resolve(io.cwd, workbookArg);
    const corrections =
      values.corrections === undefined
        ? NO_CORRECTIONS
        : loadCorrections(path.resolve(io.cwd, values.corrections));
    let data: Buffer;
    try {
      data = readFileSync(workbookPath);
    } catch (error: unknown) {
      throw new AppError("BAD_REQUEST", `The workbook ${workbookPath} could not be read.`, {
        cause: error,
      });
    }
    const sheets = await readSheets(data);

    const options = {
      personId,
      configured: configuredPeople(config.access.people),
      corrections,
      write: values.write,
      now: io.now,
    };
    const print = (report: string): void => {
      io.stdout(`Workbook: ${workbookPath}\nDatabase: ${config.databasePath}\n\n${report}`);
    };

    const scratch = mkdtempSync(path.join(os.tmpdir(), "ledger-import-"));
    let rehearsal;
    try {
      const copy = openCopy(copyBooks(config.databasePath, scratch));
      try {
        rehearsal = importWorkbook(copy, sheets, { ...options, commit: false });
      } finally {
        copy.close();
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    if (!values.write || !rehearsal.ok) {
      print(rehearsal.report);
      return rehearsal.ok ? 0 : 1;
    }

    const db = openReal(config.databasePath);
    try {
      const result = importWorkbook(db, sheets, { ...options, commit: true });
      print(result.report);
      return result.ok ? 0 : 1;
    } finally {
      db.close();
    }
  } catch (error: unknown) {
    const appError = AppError.from(error);
    const cause = appError.cause;
    const reason =
      appError.code === "INTERNAL" && cause instanceof Error ? ` (${cause.message})` : "";
    io.stderr(`${appError.message}${reason}\n`);
    return 2;
  }
}
