/**
 * `npm run household:ledger -- <add | member | remove | list> …` (lg-20).
 *
 * The household directory from the host: how the first household and its
 * members exist before anyone can sign in to the admin's screen (lg-22), and
 * how the operator recovers if that screen is ever out of reach. It writes the directory the API
 * is configured with (`DIRECTORY_PATH`), as the operator, and the API reads it
 * on every request, so a change applies without a restart.
 *
 * It never touches the books. A household's books file is made by the API the
 * first time it needs it (`books.ts`, lg-21), and a member's name is enrolled
 * into its `people` the next time the API sees anyone in the household
 * (`people.ts`).
 *
 * Exit status: 0 when the change was made or the list printed, 1 when the
 * directory refused the change, 2 when the command could not run at all.
 */

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { AppError } from "@ledger/contract";
import { loadApiConfig } from "./config.ts";
import { Directory, OPERATOR, shownName } from "./directory.ts";
import type { CommandIo } from "./import-command.ts";
import { escapeUnseen } from "@ledger/books";

const USAGE = `Usage: npm run household:ledger -- <command>

Changes who belongs to which household, in the ledger's directory (DIRECTORY_PATH).
  add <email> [person]                  create a household by adding its first person;
                                        it is named "Home" and its id is a generated UUID
  member <household> <email> [person]   add an email to a household, as that person
  remove <email>                        take an email out of its household
  list                                  every household and its members

A person is named as the household shows them, or by the id an older one was
added under. A name nobody has is a new person, given a generated id and shown
under that name; with no name, under the email's part before the @, numbered
if someone already has it. A household holds any number of people, each behind
any number of emails, and a person stays in its books once there. Every email
must also be on the ledger's Access policy, which is a dashboard edit. An older
household keeps the one-word id it was made with; list prints every id.
`;

/** Said whenever an email joins a household, which Access must admit as well. */
const ACCESS_POLICY_REMINDER =
  `Add the email to the ledger's Access policy too, in the Zero Trust dashboard ` +
  `(docs/02-DEPLOYMENT.md, step 2): until it is there, Access will not let it reach the ledger.\n`;

function usage(io: CommandIo, message: string): number {
  io.stderr(`${message}\n\n${USAGE}`);
  return 2;
}

function list(directory: Directory): string {
  const households = directory.households();
  if (households.length === 0) return "No households yet.\n";
  return households
    .map((household) => {
      const members = directory.members(household.id);
      const names = directory.names(household.id);
      // lg-76: a person is listed as they are shown, with their id beside it
      // when it differs, as a generated one always does.
      const lines = [
        ...members,
        // lg-74: a person held without an email, who Access need not admit.
        ...directory.withoutEmail(household.id).map((person) => ({ person, address: "no email" })),
      ].map((member) => {
        const shown = shownName(names, member.person);
        const who = shown === member.person ? shown : `${shown} (${member.person})`;
        // lg-82: a stored name may hold what a terminal runs, T1.
        return `  ${escapeUnseen(who)}  ${member.address}`;
      });
      return [
        `${household.id}  ${escapeUnseen(household.name)}`,
        ...(lines.length > 0 ? lines : ["  (no members)"]),
      ]
        .join("\n")
        .concat("\n");
    })
    .join("\n");
}

export function runHouseholdCommand(argv: readonly string[], io: CommandIo): number {
  let positionals: string[];
  let help: boolean;
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: { help: { type: "boolean", default: false } },
    });
    positionals = parsed.positionals;
    help = parsed.values.help;
  } catch (error: unknown) {
    return usage(io, error instanceof Error ? error.message : String(error));
  }
  if (help) {
    io.stdout(USAGE);
    return 0;
  }
  const [command, ...args] = positionals;
  const arity: Record<string, (count: number) => boolean> = {
    add: (count) => count === 1 || count === 2,
    member: (count) => count === 2 || count === 3,
    remove: (count) => count === 1,
    list: (count) => count === 0,
  };
  if (command === undefined) return usage(io, "Name a command.");
  const fits = arity[command];
  if (fits === undefined) return usage(io, `There is no command "${command}".`);
  if (!fits(args.length)) return usage(io, `Wrong arguments for ${command}.`);

  let directory: Directory;
  try {
    const config = loadApiConfig({}, io.env);
    if (config.directoryPath === ":memory:") {
      return usage(io, "DIRECTORY_PATH is :memory:, which nothing outlives; name the file.");
    }
    directory = Directory.open(config.directoryPath);
    io.stdout(`Directory: ${config.directoryPath}\n\n`);
  } catch (error: unknown) {
    const appError = AppError.from(error);
    const cause = appError.cause;
    const reason =
      appError.code === "INTERNAL" && cause instanceof Error ? ` (${cause.message})` : "";
    io.stderr(escapeUnseen(`${appError.message}${reason}`) + "\n");
    return 2;
  }

  const change = { by: OPERATOR, at: io.now(), newId: io.newId };
  // lg-82: every name this command prints is a stored one, and is escaped, T3 to T5.
  const shown = (member: { household: string; person: string }): string =>
    escapeUnseen(shownName(directory.names(member.household), member.person));
  try {
    switch (command) {
      case "add": {
        // lg-71: the household and its first person in one transaction, under a
        // UUID the operator copies from here to name it in `member`. The person
        // is printed as shown, so the household's is the one UUID on the line.
        const [address = "", person] = args;
        const { household, member } = directory.createHousehold({
          id: (io.newId ?? randomUUID)(),
          address,
          person,
          ...change,
        });
        io.stdout(
          `Created the household ${household.id}, "${escapeUnseen(household.name)}", with ${member.address} as ${shown(member)}.\n` +
            ACCESS_POLICY_REMINDER,
        );
        return 0;
      }
      case "member": {
        // lg-76: `person` is a name as shown, or an older person's id.
        const [household = "", address = "", person] = args;
        const member = directory.addMemberByName({ household, address, person, ...change });
        io.stdout(
          `Added ${member.address} to ${member.household}, as ${shown(member)}.\n` +
            ACCESS_POLICY_REMINDER,
        );
        return 0;
      }
      case "remove": {
        const [address = ""] = args;
        const removed = directory.removeMember({ address, ...change });
        io.stdout(
          `Removed ${removed.address} from ${removed.household}, where it was ${shown(removed)}. ` +
            `Its records keep the name. Take it off the ledger's Access policy too, if nothing else needs it there.\n`,
        );
        return 0;
      }
      default: {
        io.stdout(list(directory));
        return 0;
      }
    }
  } catch (error: unknown) {
    const appError = AppError.from(error);
    // lg-82: T6. The directory's refusals quote a stored name (M4 and M5), and
    // the owner chose to escape them here, where the web's text is not touched.
    if (appError.code === "INTERNAL") {
      const cause = appError.cause;
      io.stderr(
        escapeUnseen(`${appError.message}${cause instanceof Error ? ` (${cause.message})` : ""}`) +
          "\n",
      );
      return 2;
    }
    io.stderr(escapeUnseen(appError.message) + "\n");
    return 1;
  } finally {
    directory.close();
  }
}
