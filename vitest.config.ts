import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.{ts,tsx}", "apps/*/test/**/*.test.{ts,tsx}"],
    environment: "node",
    // Browser-sniffer probes launch Chromium and wait for network quiet, which
    // legitimately takes tens of seconds. A short default would fail honest tests.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // No globals: tests import `test`/`expect` explicitly, so oxlint's
    // no-undef stays meaningful and the imports document the runner.
    globals: false,
  },
});
