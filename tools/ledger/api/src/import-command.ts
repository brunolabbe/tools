/**
 * `npm run import:ledger -- <workbook.xlsx> --as <person> [--corrections <file.json>] [--write]`
 * (lg-7).
 *
 * A command and not a route: the import is a one-off, run by the owner on the
 * machine that holds the database, and has no reason to exist on the network.
 * It writes to the database the API is configured with (`DATABASE_PATH`), and
 * without `--write` it is a dry run that never opens that file for writing: the
 * books are copied into memory and the import is done there, so the report it
 * prints is what `--write` would store.
 *
 * Exit status: 0 when every verification holds, 1 when one fails (nothing is
 * written), 2 when the command could not run at all.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { readCorrections, NO_CORRECTIONS } from "@ledger/books";
import type { Corrections } from "@ledger/books";
import { AppError } from "@ledger/contract";
import Database from "better-sqlite3";
import { loadApiConfig } from "./config.ts";
import { migrate } from "./db/schema.ts";
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
 * The books to import into. A dry run copies the database file into memory —
 * opened read-only, so nothing can write to it — and works on the copy; a
 * database that does not exist yet is an empty one.
 */
function openBooks(databasePath: string, write: boolean): Database.Database {
  if (write) {
    if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true });
    const db = new Database(databasePath);
    migrate(db);
    return db;
  }
  let db: Database.Database;
  if (databasePath === ":memory:" || !existsSync(databasePath)) {
    db = new Database(":memory:");
  } else {
    // Not `readonly`: SQLite cannot open a WAL database read-only unless its
    // shared-memory file already exists, which it does only while another
    // connection is open. Nothing is written through this connection; it is
    // there to take a consistent copy, the uncheckpointed WAL included.
    const file = new Database(databasePath, { fileMustExist: true });
    try {
      const image = file.serialize();
      // Bytes 18 and 19 of the header say the file is in WAL mode, which a
      // database held in memory cannot be: SQLite refuses to open the copy
      // ("unable to open database file") until they say rollback journal.
      image[18] = 1;
      image[19] = 1;
      db = new Database(image);
    } finally {
      file.close();
    }
  }
  migrate(db);
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

    const db = openBooks(config.databasePath, values.write);
    try {
      const result = importWorkbook(db, sheets, {
        personId,
        configured: configuredPeople(config.access.people),
        corrections,
        write: values.write,
        now: io.now,
      });
      io.stdout(`Workbook: ${workbookPath}\nDatabase: ${config.databasePath}\n\n${result.report}`);
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
