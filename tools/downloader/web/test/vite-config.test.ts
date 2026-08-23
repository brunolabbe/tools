/**
 * What the dev server binds, and on which port.
 *
 * Both are load-bearing and both fail the same silent way (dl-22): the browser
 * shows a blank page, the terminal reports ready, and nothing anywhere names
 * the cause. A test is the only thing that notices a regression here, because
 * the container this runs in is the only place the bug reproduces.
 */
import { afterEach, expect, test, vi } from "vitest";
import type { UserConfig } from "vite";

const HOST_BEFORE = process.env["HOST"];

/**
 * Re-evaluates the config with `HOST` set as given. It is read at module scope,
 * so the module registry has to be dropped between cases or the second import
 * returns the first one's answer.
 */
async function serverConfigWith(host: string | undefined): Promise<UserConfig["server"]> {
  vi.resetModules();
  if (host === undefined) delete process.env["HOST"];
  else process.env["HOST"] = host;

  const module = (await import("../vite.config.ts")) as { default: UserConfig };
  return module.default.server;
}

afterEach(() => {
  if (HOST_BEFORE === undefined) delete process.env["HOST"];
  else process.env["HOST"] = HOST_BEFORE;
});

test("binds the HOST it is given, so container port forwarding can reach it", async () => {
  const server = await serverConfigWith("0.0.0.0");

  expect(server?.host).toBe("0.0.0.0");
});

test("falls back to localhost-only when HOST is unset, publishing nothing by default", async () => {
  const server = await serverConfigWith(undefined);

  // Vite's own "localhost only" — not the string "localhost", which resolves to
  // `::1` here and is the bug this whole file exists for.
  expect(server?.host).toBe(false);
});

test("fails on a taken port rather than walking to one nobody forwarded", async () => {
  const server = await serverConfigWith("0.0.0.0");

  expect(server?.port).toBe(5173);
  expect(server?.strictPort).toBe(true);
});
