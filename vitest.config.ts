import { defineConfig } from "vitest/config";

/**
 * One project per tool, plus one for the shared packages.
 *
 * The split is not cosmetic: it is what lets an agent working on one tool run
 * `vitest --project <tool>` and get an answer about its own code in seconds,
 * without waiting on — or being blocked by — a sibling tool's suite. It also
 * keeps per-tool settings from leaking; the downloader needs a minute-long
 * timeout because its browser sniffer really does take that long, and nothing
 * else should inherit that patience.
 *
 * No globals anywhere: tests import `test`/`expect` explicitly, so oxlint's
 * no-undef stays meaningful and the imports document the runner.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          include: ["packages/*/test/**/*.test.ts"],
          environment: "node",
          globals: false,
        },
      },
      {
        test: {
          name: "downloader",
          include: ["tools/downloader/*/test/**/*.test.{ts,tsx}"],
          environment: "node",
          // Browser-sniffer probes launch Chromium and wait for network quiet,
          // which legitimately takes tens of seconds. A short default would
          // fail honest tests.
          testTimeout: 60_000,
          hookTimeout: 60_000,
          globals: false,
        },
      },
      {
        test: {
          name: "planner",
          include: ["tools/planner/*/test/**/*.test.{ts,tsx}"],
          environment: "node",
          // No browser, no ffmpeg: the default timeout is honest here, and a
          // suite that talks to a model provider will use a fake rather than
          // waiting on one.
          globals: false,
        },
      },
    ],
  },
});
