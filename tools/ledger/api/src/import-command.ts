/**
 * `npm run import:ledger -- <workbook.xlsx> --household <id> --as <person> [--corrections <file.json>] [--write]`
 * (lg-7).
 *
 * A command and not a route: the import is a one-off, run by the owner on the
 * machine that holds the database, and has no reason to exist on the network.
 * It writes to one household's books, the file the API keeps for `--household`
 * in its data directory (`DATABASE_PATH`, lg-21), and to no other; `--as` names
 * a person that household's members stand under in the household directory
 * (`DIRECTORY_PATH`, lg-20), which it reads and never writes.
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

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { readCorrections, NO_CORRECTIONS } from "@ledger/books";
import type { Corrections } from "@ledger/books";
import { AppError } from "@ledger/contract";
import Database from "better-sqlite3";
import { loadApiConfig } from "./config.ts";
import { configure } from "./db/schema.ts";
import { checkDataDir, householdBooksPath } from "./books.ts";
import { Directory, isHouseholdId } from "./directory.ts";
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

const USAGE = `Usage: npm run import:ledger -- <workbook.xlsx> --household <id> --as <person> [--corrections <file.json>] [--write]

Imports a household's old workbook into that household's books, in the ledger's
data directory (DATABASE_PATH). Without --write it is a dry run: the report is
printed and nothing is written.
  --household    the household whose books the import writes, by its id in the directory
  --as           the person the import is recorded under, one of that household's members
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
export function copyBooks(databasePath: string | undefined, into: string): string | undefined {
  if (databasePath === undefined || !existsSync(databasePath)) return undefined;
  const copy = path.join(into, "ledger.db");
  copyFileSync(databasePath, copy);
  // A copy keeps the original's mode, and a read-only copy cannot be opened to
  // work on; the copy is this process's alone, in a 0700 directory.
  chmodSync(copy, 0o600);
  if (existsSync(`${databasePath}-wal`)) {
    copyFileSync(`${databasePath}-wal`, `${copy}-wal`);
    chmodSync(`${copy}-wal`, 0o600);
  }
  return copy;
}

function openCopy(copy: string | undefined): Database.Database {
  const db = new Database(copy ?? ":memory:");
  configure(db);
  return db;
}

function openReal(databasePath: string): Database.Database {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  configure(db);
  return db;
}

/**
 * The names the household's current members stand under. Read, never written:
 * the file is opened read-only, and a missing one is refused rather than
 * created, because an import into books whose household has no members would
 * be recorded under a name nobody can sign in as; so is a household the
 * directory does not hold, which has no books to import into.
 */
export function directoryPeople(directoryPath: string, household: string): string[] {
  if (directoryPath !== ":memory:" && !existsSync(directoryPath)) {
    throw new AppError(
      "BAD_REQUEST",
      `There is no household directory at ${directoryPath}. Create the household and its members first, with npm run household:ledger.`,
    );
  }
  const directory = Directory.openReadOnly(directoryPath);
  try {
    if (directory.household(household) === undefined) {
      throw new AppError(
        "BAD_REQUEST",
        `--household names "${household}", which the household directory does not hold.`,
      );
    }
    return directory.people(household);
  } finally {
    directory.close();
  }
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
        household: { type: "string" },
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
  const household = values.household?.trim();
  if (household === undefined || household === "") {
    return usage(io, "Name the household whose books the import writes, with --household.");
  }
  if (!isHouseholdId(household)) {
    return usage(io, `--household is a household's id, one lowercase word; "${household}" is not.`);
  }
  const personId = values.as?.trim();
  if (personId === undefined || personId === "") {
    return usage(io, "Name the person the import is recorded under, with --as.");
  }

  try {
    const config = loadApiConfig({}, io.env);
    if (values.write && config.dataDir === ":memory:") {
      return usage(
        io,
        "DATABASE_PATH is :memory:, which nothing outlives; name the data directory.",
      );
    }
    checkDataDir(config.dataDir);
    const members = directoryPeople(config.directoryPath, household);
    if (!members.includes(personId)) {
      return usage(
        io,
        `--as names "${personId}", who is not a member of ${household} in the household directory (${members.join(", ") || "it has none"}).`,
      );
    }
    // The one file this command opens to write, and only with --write.
    const booksPath =
      config.dataDir === ":memory:" ? undefined : householdBooksPath(config.dataDir, household);
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
      members,
      corrections,
      write: values.write,
      now: io.now,
    };
    const print = (report: string): void => {
      io.stdout(
        `Workbook: ${workbookPath}\nHousehold: ${household}\nDatabase: ${booksPath ?? ":memory:"}\n\n${report}`,
      );
    };

    const scratch = mkdtempSync(path.join(os.tmpdir(), "ledger-import-"));
    let rehearsal;
    try {
      const copy = openCopy(copyBooks(booksPath, scratch));
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

    if (booksPath === undefined) throw new AppError("INTERNAL");
    const db = openReal(booksPath);
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
