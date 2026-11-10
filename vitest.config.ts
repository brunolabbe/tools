import { defineConfig } from "vitest/config";
import { isCi } from "./vitest.isolation.ts";

/**
 * One project per tool, plus one for the shared packages, plus `repo`.
 *
 * The split is not cosmetic: it is what lets an agent working on one tool run
 * `vitest --project <tool>` and get an answer about its own code in seconds,
 * without waiting on — or being blocked by — a sibling tool's suite. It also
 * keeps per-tool settings from leaking; the downloader needs a minute-long
 * timeout because its browser sniffer really does take that long, and nothing
 * else should inherit that patience.
 *
 * **A tool's project is a file of its own, and two projects (repo-129).** The
 * downloader, planner and ledger are listed below as paths to
 * `tools/<tool>/vitest.config.ts`, each a container that `splitProject`
 * (`vitest.isolation.ts`) turns into `<tool> (shared)`, which runs with
 * `isolate: false`, and `<tool> (isolated)`, the files that mock a module, stub
 * a global or an environment variable, or reset modules, plus any a container
 * names. `--project <tool>` selects both halves. Per-tool settings (timeouts,
 * setup files) live in that file, beside the reason for them. `core` and `repo`
 * stay inline and isolated: they finish in seconds, and what they spend it on is
 * not importing.
 *
 * A file project owns its values and inherits nothing from this config, which
 * is why `splitProject` sets repo-99's `maxWorkers` itself, from the same
 * `isCi`.
 *
 * No globals anywhere: tests import `test`/`expect` explicitly, so oxlint's
 * no-undef stays meaningful and the imports document the runner.
 */
export default defineConfig({
  test: {
    // More workers, on CI only (repo-99). Most of this suite's wall time is
    // waiting — timers, sockets, child processes — so vitest's default of
    // cores - 1 (three on the four-vCPU runner) leaves CI's cores idle. Four,
    // one per vCPU: six oversubscribed the Windows runner and flaked
    // parallel-ranges (repo-99 Log). A developer machine is shared, and an
    // orchestrator runs several reviewers on it at once, so it keeps vitest's
    // default and never gets the bump.
    //
    // "CI is set" is test-gate.mjs's own test: the strings "", "false" and "0"
    // are not CI, so a local `CI=false` run is not capped.
    //
    // At the root, not per project: vitest 5's inline projects extend the root
    // config by default, so each inherits its maxWorkers, and resolveConfig's
    // getDefaultMaxWorkers (the core count less one) applies only where none is
    // set. No project sets one.
    ...(isCi(process.env.CI) ? { maxWorkers: 4 } : {}),
    projects: [
      {
        test: {
          name: "core",
          // `.tsx` for `@webtools/ui`'s components (repo-131), which take a DOM
          // per file from a `@vitest-environment jsdom` docblock, as the tools'
          // `web` suites do; everything else here stays on node.
          include: ["packages/*/test/**/*.test.{ts,tsx}"],
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
      "tools/downloader/vitest.config.ts",
      "tools/planner/vitest.config.ts",
      "tools/ledger/vitest.config.ts",
    ],
  },
});
