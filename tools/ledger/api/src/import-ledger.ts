/**
 * Entry point of `npm run import:ledger` (lg-7). Everything is in
 * `import-command.ts`; this file owns only the process, as `main.ts` does for
 * the server.
 */

import process from "node:process";
import { runImportCommand } from "./import-command.ts";

const code = await runImportCommand(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  // npm runs a workspace's script from the workspace's directory, and says
  // where it was started from here, which is where a relative path was meant.
  cwd: process.env["INIT_CWD"] ?? process.cwd(),
  now: () => new Date(),
});
process.exitCode = code;
