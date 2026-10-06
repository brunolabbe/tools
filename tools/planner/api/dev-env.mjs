// Loaded by the `dev` script only, with --import, before the API starts: puts
// tools/planner/.env into process.env when the file exists. Not
// --env-file-if-exists, because node --watch then watches the file and dies
// with ENOENT when it is absent, which is every fresh checkout. A variable
// already set in the shell wins over the file. Outside src/, so it is never
// built into dist/ or shipped in the image.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
