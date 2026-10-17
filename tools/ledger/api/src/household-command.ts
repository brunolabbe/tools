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

import { parseArgs } from "node:util";
import { AppError } from "@ledger/contract";
import { loadApiConfig } from "./config.ts";
import { Directory, OPERATOR } from "./directory.ts";
import type { CommandIo } from "./import-command.ts";

const USAGE = `Usage: npm run household:ledger -- <command>

Changes who belongs to which household, in the ledger's directory (DIRECTORY_PATH).
  add <household> <display name>        create a household; its id is one lowercase word
  member <household> <address> <person> add an address to a household, as that person
  remove <address>                      take an address out of its household
  list                                  every household and its members

A household holds any number of people, each behind any number of addresses,
and a name stays in its books once there. Every address must also be on the
ledger's Access policy, which is a dashboard edit.
`;

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
      const lines = members.map((member) => `  ${member.person}  ${member.address}`);
      return [
        `${household.id}  ${household.name}`,
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
    add: (count) => count >= 2,
    member: (count) => count === 3,
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
    io.stderr(`${appError.message}${reason}\n`);
    return 2;
  }

  const change = { by: OPERATOR, at: io.now() };
  try {
    switch (command) {
      case "add": {
        const [id = "", ...name] = args;
        const household = directory.addHousehold({ id, name: name.join(" "), ...change });
        io.stdout(`Created the household ${household.id}, "${household.name}".\n`);
        return 0;
      }
      case "member": {
        const [household = "", address = "", person = ""] = args;
        const member = directory.addMember({ household, address, person, ...change });
        io.stdout(
          `Added ${member.address} to ${member.household}, as ${member.person}.\n` +
            `Add the address to the ledger's Access policy too, in the Zero Trust dashboard ` +
            `(docs/02-DEPLOYMENT.md, step 2): until it is there, Access will not let it reach the ledger.\n`,
        );
        return 0;
      }
      case "remove": {
        const [address = ""] = args;
        const removed = directory.removeMember({ address, ...change });
        io.stdout(
          `Removed ${removed.address} from ${removed.household}, where it was ${removed.person}. ` +
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
    if (appError.code === "INTERNAL") {
      const cause = appError.cause;
      io.stderr(`${appError.message}${cause instanceof Error ? ` (${cause.message})` : ""}\n`);
      return 2;
    }
    io.stderr(`${appError.message}\n`);
    return 1;
  } finally {
    directory.close();
  }
}
