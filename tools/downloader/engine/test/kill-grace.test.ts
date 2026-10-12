/**
 * The window between SIGTERM and SIGKILL (dl-116).
 *
 * `killProcessTree` waits `graceMs` after SIGTERM for the group to leave before
 * it sends SIGKILL. The default is 3000 ms and is production behaviour: ffmpeg
 * needs the moment to write a trailer. Tests that cancel a job pass a shorter
 * one so they do not wait it out, and these tests are what keep that from
 * quietly becoming the default.
 *
 * The child ignores SIGTERM, and the clock is a fake one, so the boundary is read
 * off the time SIGKILL was sent to the millisecond rather than waited for. POSIX only: the Windows branch is `taskkill /T /F` and has no
 * grace to pin.
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import process from "node:process";
import { AppError } from "@downloader/contract";
import { afterEach, describe, expect, test, vi } from "vitest";
import { killProcessTree } from "../src/ffmpeg/kill.ts";
import { streamFfmpeg } from "../src/ffmpeg/runner.ts";

const posix = process.platform !== "win32";

/** Leaves its own process group and ignores SIGTERM, as a stuck ffmpeg would. */
const IGNORES_SIGTERM = `process.on("SIGTERM", () => undefined);
setInterval(() => undefined, 1000);
process.stdout.write("ready\\n");`;

const children: ChildProcess[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
});

async function stubbornChild(): Promise<{ pid: number; exited: Promise<void> }> {
  const child = spawn(process.execPath, ["-e", IGNORES_SIGTERM], {
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  children.push(child);
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  // Its handler is installed before it says so: a SIGTERM sent earlier would end it.
  await new Promise<void>((resolve) => child.stdout?.once("data", () => resolve()));
  return { pid: child.pid as number, exited };
}

/**
 * Every signal the kill sends, with the fake clock's time of sending. The
 * child's death cannot be the measurement: a SIGKILLed child stays a zombie, and
 * so "alive" to `kill(pid, 0)`, until the event loop reaps it, which a fake
 * clock does not give time for.
 */
function recordSignals(): { atMs: number; signal: string }[] {
  const sent: { atMs: number; signal: string }[] = [];
  const started = Date.now();
  const send = process.kill.bind(process);
  vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (typeof signal === "string") sent.push({ atMs: Date.now() - started, signal });
    return send(pid, signal);
  });
  return sent;
}

describe.skipIf(!posix)("the kill grace", () => {
  test("is 3000 ms when nothing is passed", async () => {
    const { pid, exited } = await stubbornChild();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
    const sent = recordSignals();

    const killed = killProcessTree(pid);
    await vi.advanceTimersByTimeAsync(2900);
    // Asked to leave, and not yet told to.
    expect(sent.map((entry) => entry.signal)).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(200);
    await killed;
    expect(sent.map((entry) => entry.signal)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(sent[1]?.atMs).toBeGreaterThanOrEqual(3000);
    vi.useRealTimers();
    await exited;
  });

  test("is the one that is passed, and a shorter one ends the group sooner", async () => {
    const { pid, exited } = await stubbornChild();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
    const sent = recordSignals();

    const killed = killProcessTree(pid, { graceMs: 200 });
    await vi.advanceTimersByTimeAsync(300);
    await killed;
    expect(sent.map((entry) => entry.signal)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(sent[1]?.atMs).toBeLessThan(1000);
    vi.useRealTimers();
    await exited;
  });

  test("reaches the runner: killGraceMs ends a job whose ffmpeg ignores SIGTERM", async () => {
    const controller = new AbortController();
    const ffmpeg = streamFfmpeg({
      ffmpegPath: process.execPath,
      args: ["-e", IGNORES_SIGTERM],
      signal: controller.signal,
      killGraceMs: 200,
    });
    ffmpeg.stdout.resume();
    await new Promise<void>((resolve) => ffmpeg.stdout.once("data", () => resolve()));

    const started = performance.now();
    controller.abort();
    const failure = await ffmpeg.completion.then(
      () => null,
      (error: unknown) => AppError.from(error),
    );
    expect(failure?.code).toBe("JOB_CANCELED");
    // Well under the 3 s default: a runner that dropped the option would take it.
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
