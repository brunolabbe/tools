/**
 * What the dev server binds, and on which port.
 *
 * All three values fail the same silent way: the browser shows a blank page,
 * the terminal reports ready, and nothing anywhere names the cause. `host` is
 * the `::1` bind the config's own docblock describes, and `strictPort` is the
 * port walk that lands the server on 5194 — a port
 * `.devcontainer/devcontainer.json` never forwarded. A test is the only thing
 * that notices a regression here, because the container this runs in is the
 * only place either bug reproduces.
 *
 * The twin of the planner's (pl-32) and the downloader's (dl-22), written with
 * the tool rather than after it: `packages/core/test/host-resolution.test.ts`
 * catches a tool with no `HOST` resolution at all, and only this evaluates what
 * the config actually resolves to.
 */
import { readFileSync } from "node:fs";
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

  // 5193, not the downloader's 5173 or the planner's 5183: every tool runs at
  // once, and 5193 is the number `.devcontainer/devcontainer.json` forwards and
  // labels "ledger web".
  expect(server?.port).toBe(5193);
  expect(server?.strictPort).toBe(true);
});

async function config(): Promise<UserConfig> {
  vi.resetModules();
  return ((await import("../vite.config.ts")) as { default: UserConfig }).default;
}

test("writes the API's version into the bundle, the number release-please bumps (lg-72)", async () => {
  const api = JSON.parse(
    readFileSync(new URL("../../api/package.json", import.meta.url), "utf8"),
  ) as { version: string };

  expect((await config()).define?.["__TOOL_VERSION__"]).toBe(JSON.stringify(api.version));
});

test("names the terms page's theme module at a fixed path, and every other entry hashed", async () => {
  const options = (await config()).build?.rolldownOptions;
  const output = Array.isArray(options?.output) ? options.output[0] : options?.output;
  const names = output?.entryFileNames;

  expect(Object.keys((options?.input ?? {}) as Record<string, string>)).toEqual(["index", "theme"]);
  expect(typeof names).toBe("function");
  if (typeof names !== "function") return;
  // `public/terms.html` names `/theme.js` literally, so a hash here is a page with no theme.
  expect(names({ name: "theme" } as Parameters<typeof names>[0])).toBe("theme.js");
  expect(names({ name: "index" } as Parameters<typeof names>[0])).toBe("assets/[name]-[hash].js");
});

test("holds the first paint with the shared render-blocking plugin, pinned in @webtools/ui (repo-131)", async () => {
  const names = ((await config()).plugins ?? [])
    .flat()
    .map((plugin) =>
      typeof plugin === "object" && plugin !== null && "name" in plugin ? plugin.name : undefined,
    );

  expect(names).toContain("webtools-render-blocking-entry");
});
