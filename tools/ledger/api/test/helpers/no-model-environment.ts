/**
 * Run before every file of the ledger's vitest project (`setupFiles` in the root
 * `vitest.config.ts`): the host's Anthropic variables never reach a test (lg-8's
 * gate 1, F6).
 *
 * `loadApiConfig` reads them, and a dozen files build an app without pinning
 * the receipt reader's configuration. With a key and `ANTHROPIC_CUSTOM_HEADERS`
 * both set on a developer's machine, every one of them refused to boot (332
 * tests); with a key alone, each built the real model reader, one stray read
 * away from a paid call. A test that wants a variable passes its own `env`, or
 * stubs it with `vi.stubEnv`. Here rather than in each helper that builds an
 * app, so a file added later is covered without anyone remembering to.
 */

import process from "node:process";

for (const name of Object.keys(process.env)) {
  if (name.startsWith("ANTHROPIC_") || name === "RECEIPT_MODEL") delete process.env[name];
}
