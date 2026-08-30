/**
 * `HOST` is read by four files in two shapes, and both shapes are load-bearing.
 *
 * The container sets `HOST=0.0.0.0` because `localhost` resolves to `::1` in it,
 * and Docker's port forwarding connects over IPv4. A process that ignores `HOST`
 * therefore binds an address nothing can reach — and says nothing about it. That
 * is dl-22's blank page, and it is the whole reason this scan exists: the failure
 * has no symptom other than "it does not work", so the only thing that catches it
 * is something that looks.
 *
 * repo-5 decided the resolution stays duplicated rather than lifting to
 * `packages/` — 14 of its 15 lines are a docblock, and putting the one line of
 * code behind a built `@webtools/*` dependency trades an error naming a source
 * line for a Vite that refuses to start behind an esbuild stack blaming a
 * `package.json`. This file is what the copies were traded for. It lives in
 * `packages/core/test/` beside `spawn-safety` and `image-closure` for the reason
 * those do: the rule is repo-wide, and a check scoped to a tool is a check nobody
 * runs when the next tool arrives.
 *
 * **Two contracts, asserted apart, because the fallbacks are different types.**
 *
 * - `tools/<tool>/web/vite.config.ts` resolves `string | false`. `false` is
 *   Vite's own "localhost only" sentinel, and the *right* default off a
 *   container: a laptop should not publish a dev server on its network without
 *   being asked. Flattening this into the API's rule would let a web config
 *   default to a string and quietly start doing that.
 * - `tools/<tool>/api/src/**` resolves `string`, defaulting to `127.0.0.1` via
 *   its own `API_DEFAULTS`. `false` is not a bind address; a listener has to be
 *   told something. Flattening the other way would let an API "default to
 *   localhost only", which is not a value it can pass to `listen`.
 *
 * So the shared thing is the *question* — does this half of the tool obey `HOST`,
 * and does it say what it does when `HOST` is unset — and the answers legitimately
 * differ. That is also why the lift was declined: what wanted sharing was never
 * the four lines.
 *
 * **What this is not.** Each tool already pins its own dev server's behaviour by
 * evaluating its config — `tools/downloader/web/test/vite-config.test.ts` (dl-22)
 * and `tools/planner/web/test/vite-config.test.ts` (pl-32). Those are stronger
 * than a text match and they stay the primary check. They also only exist for
 * tools somebody remembered to write them for, and a third tool arrives with
 * neither. This scan is the one that fails for a tool it has never seen.
 *
 * It follows `spawn-safety`'s bar in shape: read the text, match plainly, name
 * the file and what was missing. It is a scan, not a parser — a config that
 * computed its host through a helper this cannot see would fail here, and the
 * answer to that is to spell the resolution out in the config, not to teach this
 * file to evaluate TypeScript.
 *
 * Nothing below throws while the module loads. A tree this could not read has
 * found something, and it deserves a named failing test rather than a collection
 * error that reads as a broken suite.
 */

import path from "node:path";
import { expect, test } from "vitest";
import { readFileOrNull, REPO_ROOT, sourcesUnder, workspaceDirs } from "./support/workspaces.ts";

/**
 * `env["HOST"]` with whatever it falls back to, for either spelling of `env`:
 * the web configs read `process.env` directly, the API configs take an `env`
 * parameter so a test can hand them one. The fallback capture stops at the
 * punctuation that ends the expression at both call sites — `;` after the web
 * config's `const`, `,` inside the API's object literal.
 */
const HOST_FALLBACK = /(?:process\.)?env\[\s*["']HOST["']\s*\]\s*\?\?\s*([^\n,;)]+)/u;
const HOST_READ = /(?:process\.)?env\[\s*["']HOST["']\s*\]/u;

/** Spellings that are not a bind address, whatever else they are. */
const NOT_AN_ADDRESS = new Set(["false", "true", "undefined", "null", '""', "''", "``"]);

function fallbackIn(text: string): string | null {
  const match = HOST_FALLBACK.exec(text);
  return match?.[1]?.trim() ?? null;
}

/** Every workspace directory named `web`, or every one named `api`. */
async function toolPackages(name: "web" | "api"): Promise<string[]> {
  const dirs = await workspaceDirs();
  return dirs.filter((dir) => dir.startsWith("tools/") && dir.endsWith(`/${name}`));
}

/**
 * Two, today. Asserted so that a scan which stopped finding anything — a renamed
 * `tools/`, a `workspaceDirs` that changed shape under it — fails as a scan that
 * found nothing rather than passing as a repo with nothing wrong.
 */
const TOOLS_TODAY = 2;

test("every tool's web dev server binds HOST, and refuses a port nobody forwarded", async () => {
  const dirs = await toolPackages("web");
  const problems: string[] = [];

  for (const dir of dirs) {
    const file = `${dir}/vite.config.ts`;
    // oxlint-disable-next-line no-await-in-loop
    const text = await readFileOrNull(path.join(REPO_ROOT, dir, "vite.config.ts"));

    if (text === null) {
      // A web workspace with no Vite config binds Vite's default, which is
      // `localhost`, which is `::1` here.
      problems.push(`${file}: no such file`);
      continue;
    }

    if (!HOST_READ.test(text)) {
      problems.push(
        `${file}: does not read env["HOST"], so the container's HOST=0.0.0.0 is ignored`,
      );
    } else {
      // Vite's sentinel, spelled exactly. A string default here would publish
      // the dev server on the network of every laptop that ran it.
      const fallback = fallbackIn(text);
      if (fallback !== "false") {
        problems.push(`${file}: HOST falls back to ${fallback ?? "nothing"}, not Vite's false`);
      }
    }

    if (!/\bstrictPort:\s*true\b/u.test(text)) {
      // Without it Vite walks to the next free port, which nobody forwarded,
      // and reports ready anyway.
      problems.push(`${file}: no strictPort: true`);
    }
  }

  expect(problems).toEqual([]);
  expect(dirs.length).toBeGreaterThanOrEqual(TOOLS_TODAY);
});

test("every tool's API resolves HOST to an explicit address", async () => {
  const dirs = await toolPackages("api");
  const problems: string[] = [];

  for (const dir of dirs) {
    // The whole of `src`, not a named `config.ts`: which file resolves the
    // config is a tool's own business, and pinning the path here would fail a
    // tool that is doing nothing wrong.
    // oxlint-disable-next-line no-await-in-loop
    const sources = await sourcesUnder(dir);
    const readers = sources.filter((source) => HOST_READ.test(source.text));

    if (readers.length === 0) {
      problems.push(
        `${dir}: nothing under src reads env["HOST"], so the API listens where the container cannot reach it`,
      );
      continue;
    }

    for (const reader of readers) {
      const fallback = fallbackIn(reader.text);
      if (fallback === null) {
        // An API with no HOST set must still be told an address to listen on.
        problems.push(`${reader.file}: reads env["HOST"] with no ?? default`);
        continue;
      }
      // Not `false`: this half resolves a string. The web contract's sentinel is
      // meaningless to `listen`, and accepting it here is how the two rules
      // would silently become one.
      if (NOT_AN_ADDRESS.has(fallback)) {
        problems.push(
          `${reader.file}: HOST falls back to ${fallback}, which is not a bind address`,
        );
      }
    }
  }

  expect(problems).toEqual([]);
  expect(dirs.length).toBeGreaterThanOrEqual(TOOLS_TODAY);
});
