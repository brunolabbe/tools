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
          // Repo tooling, which belongs to no tool and ships in no image: the
          // commit-message convention the hook and the PR gate share. It is
          // plain `.mjs` and deliberately outside the `tsc --build` graph, so
          // this project is the only thing that checks it.
          name: "repo",
          include: ["scripts/test/**/*.test.ts"],
          environment: "node",
          // These suites test CLIs, so every case spawns real `git` and `node`
          // processes rather than importing a function. That is the point — the
          // argument parsing and the exit code are the contract — but it makes
          // the cost of a case a process-spawn cost, and on the Windows runner a
          // spawn is roughly two orders of magnitude dearer than here: the
          // citations case that builds a four-commit repo and runs the checker
          // takes 71 ms locally and took 9194 ms on windows-latest, timing out
          // against vitest's 5 s default and failing CI on a branch that had
          // changed no code (run 33991666700). Its neighbours landed at 4.2 s,
          // 2.7 s and 2.5 s, so the whole project was sitting just under the
          // line. 30 s is ~3x the worst measured case and still far short of
          // the downloader's minute: a CLI spawn that takes half a minute is
          // hung, not slow, and should still fail.
          //
          // testTimeout only, deliberately: no case here uses a before/after
          // hook — each builds and tears down its own fixture inline — so a
          // hookTimeout would be config that never runs.
          testTimeout: 30_000,
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
