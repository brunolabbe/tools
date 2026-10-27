/**
 * `npm run backfill-spending:ledger -- --household <id> --as <person> [--write]` (lg-53).
 *
 * A command and not a route, for the import's reason: it is a one-off, run by
 * the owner on the machine that holds the books. It writes one household's
 * books, recorded under `--as`, a member of that household in the directory.
 *
 * **A dry run never opens the books**: it works on a private copy, as the
 * import's does (`import-command.ts` says why opening is already a write), and
 * prints what `--write` would record. Both migrate first, since the categories
 * the texts name arrive with migration 12.
 *
 * Exit status: 0 when it ran, 2 when it could not run at all.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { AppError } from "@ledger/contract";
import Database from "better-sqlite3";
import { checkDataDir, householdBooksPath } from "./books.ts";
import { loadApiConfig } from "./config.ts";
import { migrate } from "./db/schema.ts";
import { isHouseholdId } from "./directory.ts";
import { copyBooks, directoryPeople, memberNamed, membersListed } from "./import-command.ts";
import type { CommandIo } from "./import-command.ts";
import { knownPeople } from "./people.ts";
import { backfillSpending } from "./spending-backfill.ts";

const USAGE = `Usage: npm run backfill-spending:ledger -- --household <id> --as <person> [--write]

Gives a spending category to the bank rows and card lines whose text names one
(Taxes, Épicerie, Hydro Québec, Netflix…), in one household's books. Only what
has no category is filled. Without --write it is a dry run: the report is
printed and nothing is written.
  --household  the household whose books it writes, by its id in the directory
  --as         the person it is recorded under, one of that household's members
  --write      record what the dry run reports
`;

function usage(io: CommandIo, message: string): number {
  io.stderr(`${message}\n\n${USAGE}`);
  return 2;
}

function run(file: string, personId: string, io: CommandIo): string {
  const db = new Database(file);
  try {
    migrate(db);
    return backfillSpending({
      db,
      personId,
      now: io.now,
      people: new Set(knownPeople(db)),
    }).report;
  } finally {
    db.close();
  }
}

export function runSpendingBackfillCommand(argv: readonly string[], io: CommandIo): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        write: { type: "boolean", default: false },
        as: { type: "string" },
        household: { type: "string" },
        help: { type: "boolean", default: false },
      },
    });
  } catch (error: unknown) {
    return usage(io, error instanceof Error ? error.message : String(error));
  }
  const { values } = parsed;
  if (values.help) {
    io.stdout(USAGE);
    return 0;
  }
  const household = values.household?.trim();
  if (household === undefined || household === "") {
    return usage(io, "Name the household whose books it writes, with --household.");
  }
  if (!isHouseholdId(household)) {
    return usage(
      io,
      `--household is a household's id, as household:ledger list prints it; "${household}" is not.`,
    );
  }
  const as = values.as?.trim();
  if (as === undefined || as === "") {
    return usage(io, "Name the person it is recorded under, with --as.");
  }

  try {
    const config = loadApiConfig({}, io.env);
    if (config.dataDir === ":memory:") {
      return usage(io, "DATABASE_PATH is :memory:, which holds no books to fill.");
    }
    checkDataDir(config.dataDir);
    // lg-76: by the name the household shows them under, or an older person's id.
    const found = directoryPeople(config.directoryPath, household);
    const personId = memberNamed(found, as);
    if (personId === undefined) {
      return usage(
        io,
        `--as names "${as}", who is not a member of ${household} in the household directory (${membersListed(found) || "it has none"}).`,
      );
    }
    const booksPath = householdBooksPath(config.dataDir, household);
    // Nothing to fill, and no reason to make an empty file to say so.
    if (!existsSync(booksPath)) {
      return usage(io, `${household} has no books yet at ${booksPath}.`);
    }
    const heading = `Household: ${household}\nDatabase: ${booksPath}\n${values.write ? "" : "Dry run: nothing is written.\n"}\n`;

    if (values.write) {
      io.stdout(heading + run(booksPath, personId, io));
      return 0;
    }
    const scratch = mkdtempSync(path.join(os.tmpdir(), "ledger-backfill-"));
    try {
      const copy = copyBooks(booksPath, scratch);
      if (copy === undefined) throw new AppError("INTERNAL");
      io.stdout(heading + run(copy, personId, io));
      return 0;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
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
