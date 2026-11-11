import { defineConfig } from "vitest/config";
import { splitProject } from "../../vitest.isolation.ts";

export default defineConfig(
  splitProject({
    name: "ledger",
    parent: "tools/ledger",
    test: {
      // No browser and no network in any unit suite. The receipt reader
      // that talks to a model gets a fake here, as the planner's does, and
      // the host's Anthropic variables are cleared before every file
      // (lg-8's gate 1, F6), so none reaches `loadApiConfig`.
      setupFiles: ["tools/ledger/api/test/helpers/no-model-environment.ts"],
      // The timeout is the planner's, for the planner's reason: the same
      // `busy_timeout = 5000` in `migrate` against a database file (repo-93).
      testTimeout: 20_000,
    },
  }),
);
