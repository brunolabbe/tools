/**
 * A fake `gh` for a test that spawns a script which runs `gh` for real.
 *
 * Two tests need one: `preflight.test.ts` (repo-71, which keeps its own copy of
 * the same plant) and `review-record.test.ts`'s `--land` CLI case (repo-89).
 * Each reaches `gh` through `preflight.mjs`'s check 5, which spawns `gh pr list`
 * with `shell: false` — and a `#!/bin/sh` file named `gh` is never found on
 * Windows, where libuv's `PATH` search appends only `.com` and `.exe` to a bare
 * name. The spawn then falls through to the runner's real `gh`, whose latency a
 * test does not control: 41 s once in repo-71. The `--land` case timed out at
 * 49 s once (repo-89), and `gh` is the one spawn in it that can reach a network — cause
 * not proven on Windows — against about 1 s for `preflight.test.ts`'s case,
 * where a fake answers.
 *
 * So the fake is a real executable on every platform: this process's own
 * `node`, reached under the name `gh` (`gh.exe` on Windows — a hard link, or a
 * copy where the link is refused, since a Windows symlink needs a privilege a
 * developer machine may not grant). Invoked as `gh pr list --state open …` with
 * `cwd` at the fixture, node runs `pr` there as its script, and `pr.js` is
 * planted to print a marker and exit 1. The marker is what lets a test assert
 * that its own fake answered rather than assume it; a real `gh` in a
 * remote-less fixture also exits non-zero, so the exit code cannot tell.
 */

import fs from "node:fs";
import path from "node:path";

/** What the planted `gh` prints on stderr before it exits 1. */
export const FAKE_GH_MARKER = "fake gh answered";

/**
 * Plant the fake under `<cwd>/.fake-gh` and `<cwd>/pr.js`, and return a `PATH`
 * value that finds it first — for the caller to put in a spawn's `env`, or to
 * stub over `process.env.PATH` for the length of one spawn. Both files live
 * inside `cwd`, so removing the fixture removes them.
 */
export function fakeGhPath(cwd: string): string {
  const shimDir = path.join(cwd, ".fake-gh");
  fs.mkdirSync(shimDir, { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "pr.js"),
    `process.stderr.write(${JSON.stringify(`${FAKE_GH_MARKER}\n`)});\nprocess.exit(1);\n`,
  );
  if (process.platform === "win32") {
    const ghPath = path.join(shimDir, "gh.exe");
    try {
      fs.linkSync(process.execPath, ghPath);
    } catch {
      fs.copyFileSync(process.execPath, ghPath);
    }
  } else {
    fs.symlinkSync(process.execPath, path.join(shimDir, "gh"));
  }
  return `${shimDir}${path.delimiter}${process.env.PATH}`;
}
