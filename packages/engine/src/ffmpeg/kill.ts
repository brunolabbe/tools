/**
 * Killing a process *tree*.
 *
 * `child.kill()` signals one process. ffmpeg reading an HLS manifest does not
 * fork, but on Windows the spawned binary is frequently reparented and a bare
 * kill leaves it holding the output file open, which then cannot be deleted by
 * the cleanup path — the visible symptom is `EBUSY` on `rm -r tmp/<jobId>`.
 *
 * Windows has no process groups usable from Node, so the only reliable answer
 * is `taskkill /T /F`. POSIX has them, so we spawn detached and signal the
 * negative pid, giving the group a moment to exit on SIGTERM before SIGKILL.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import type { Logger } from "../logger.ts";
import { NOOP_LOGGER } from "../logger.ts";

export const IS_WINDOWS = process.platform === "win32";

/** Pure, so the "no shell, correct flags" assertion is a unit test. */
export function buildTaskkillArgs(pid: number): string[] {
  return ["/PID", String(pid), "/T", "/F"];
}

/**
 * Absolute path to taskkill. Resolving it ourselves rather than relying on PATH
 * removes a search-order hijack: PATH is inherited from whatever launched the
 * service.
 */
export function taskkillPath(env: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = env["SystemRoot"] ?? env["windir"] ?? "C:\\Windows";
  return path.join(systemRoot, "System32", "taskkill.exe");
}

/** True when the process still exists. Signal 0 performs the permission check only. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killTreeWindows(pid: number, logger: Logger): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(taskkillPath(), buildTaskkillArgs(pid), {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", (error) => {
      logger.warn("taskkill failed to launch", { pid, error: String(error) });
      resolve();
    });
    child.once("close", () => {
      resolve();
    });
  });
}

async function killTreePosix(pid: number, graceMs: number): Promise<void> {
  const signalGroup = (signal: NodeJS.Signals): boolean => {
    try {
      // Negative pid targets the whole process group, which only exists because
      // the child was spawned with `detached: true`.
      process.kill(-pid, signal);
      return true;
    } catch {
      try {
        process.kill(pid, signal);
        return true;
      } catch {
        return false;
      }
    }
  };

  if (!signalGroup("SIGTERM")) return;

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  signalGroup("SIGKILL");
}

export interface KillTreeOptions {
  /** How long the POSIX branch waits after SIGTERM before SIGKILL. */
  graceMs?: number;
  logger?: Logger;
}

/** Best-effort and idempotent: an already-dead pid is not an error. */
export async function killProcessTree(pid: number, options: KillTreeOptions = {}): Promise<void> {
  const logger = options.logger ?? NOOP_LOGGER;
  if (!Number.isInteger(pid) || pid <= 0) return;

  logger.debug("killing process tree", { pid, platform: process.platform });
  if (IS_WINDOWS) {
    await killTreeWindows(pid, logger);
  } else {
    await killTreePosix(pid, options.graceMs ?? 3000);
  }
}
