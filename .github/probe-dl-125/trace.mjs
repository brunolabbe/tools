/**
 * dl-125 probe instrumentation. DO NOT MERGE.
 *
 * Why it exists: the dl-103 test's failure message carries the outcome and not
 * ffmpeg's log, so a failing run cannot say whether ffmpeg logged
 * `partial file`, which is what dl-125's step 2 asks. This file adds that
 * without changing the test or the engine.
 *
 * Preloaded into every node process of a loop iteration with
 * `NODE_OPTIONS=--import <this file's URL>`, so the dl-103 test runs as it is
 * on main, through the repo's own vitest config. It wraps
 * `child_process.spawn` and appends JSON lines to `DL125_TRACE_FILE`:
 *
 *  - for the engine's stream ffmpeg (the one spawn whose arguments carry
 *    `-progress pipe:3` and write to `pipe:1`; its input is the engine's own
 *    local URL, not the origin's): the spawn, every stderr chunk as it reaches
 *    the parent, the end of stderr, `exit` and `close`, each with milliseconds
 *    since the spawn;
 *  - for the fixture's `+faststart` remux: the size of the file it wrote.
 *
 * It listens to stderr only. The engine reads stderr with a `data` listener
 * attached in the same tick, so a second one changes nothing it sees, and a
 * chunk's time here is the time the engine read it. stdout is left alone: a
 * `data` listener there would switch the media pipe to flowing mode before the
 * engine reads its first chunk. The engine's `completion` settles on `close`.
 */
import childProcess from "node:child_process";
import { appendFileSync, statSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const traceFile = process.env["DL125_TRACE_FILE"];

if (traceFile !== undefined && traceFile.length > 0) {
  const original = childProcess.spawn;
  childProcess.spawn = function traced(command, args, options) {
    const child = original.call(this, command, args, options);
    const list = Array.isArray(args) ? args.map(String) : [];
    const started = performance.now();
    const write = (event, text) => {
      appendFileSync(
        traceFile,
        `${JSON.stringify({
          worker: process.pid,
          ffmpeg: child.pid,
          ms: Number((performance.now() - started).toFixed(1)),
          event,
          text,
        })}\n`,
      );
    };
    if (list.includes("+faststart") && list.some((arg) => /[\\/]large[\\/]/u.test(arg))) {
      const output = list.at(-1) ?? "";
      child.once("close", () => {
        let size = "missing";
        try {
          size = String(statSync(output).size);
        } catch {
          // Reported as missing.
        }
        write("fixture", `faststart.mp4 ${size} bytes`);
      });
      return child;
    }
    if (!(list.includes("-progress") && list.includes("pipe:3") && list.includes("pipe:1"))) {
      return child;
    }
    write("spawn", `${String(command)} ${list.join(" ")}`);
    child.stderr?.on("data", (chunk) => write("stderr", String(chunk)));
    child.stderr?.on("end", () => write("stderr-end", ""));
    child.once("exit", (code, signal) => write("exit", `${code} ${signal}`));
    child.once("close", (code, signal) => write("close", `${code} ${signal}`));
    return child;
  };
  syncBuiltinESMExports();
}
