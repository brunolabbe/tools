/**
 * `renderBlockingEntry`, the Vite plugin a tool's `vite.config.ts` imports from
 * `@webtools/ui/vite` (repo-131, lifted from the downloader on the ledger's
 * need, owner 2026-10-31).
 *
 * The plugin rewrites the tag Vite writes for a built entry, so the case that
 * matters is a real `vite build`: if Vite ever writes that tag in a shape the
 * plugin does not match, the build below fails, here, rather than the page
 * quietly painting before its theme (gate 1's maintainability note).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { build } from "vite";
import type { Plugin } from "vite";
import { addRenderBlocking, renderBlockingEntry } from "../src/vite.ts";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture(html: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "webtools-ui-vite-"));
  made.push(root);
  fs.writeFileSync(path.join(root, "index.html"), html);
  fs.writeFileSync(path.join(root, "main.js"), 'document.title = "built";\n');
  return root;
}

/** The plugin's HTML hook, called the way Vite calls it, with an `error` that throws. */
function runHook(html: string): string {
  const plugin = renderBlockingEntry();
  const hook = plugin.transformIndexHtml;
  if (hook === undefined || typeof hook === "function") throw new Error("expected an ordered hook");
  const context = {
    error: (message: string): never => {
      throw new Error(message);
    },
  };
  const handler = hook.handler as unknown as (this: typeof context, html: string) => string;
  return handler.call(context, html);
}

test("a real vite build: the entry Vite writes comes out render-blocking", async () => {
  // `index.html` asks for the attribute too, as a tool's does; Vite drops it
  // from the tag it writes, which is why the plugin exists.
  const root = fixture(
    '<!doctype html><html><head><script type="module" src="/main.js" blocking="render"></script></head><body></body></html>',
  );
  const outDir = path.join(root, "dist");

  await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [renderBlockingEntry() as Plugin],
    build: { outDir, emptyOutDir: true },
  });

  const built = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
  const entries = [...built.matchAll(/<script\b[^>]*>/gu)].map((match) => match[0]);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatch(/\bsrc="\/assets\/[^"]+\.js"/u);
  expect(entries[0]).toContain('blocking="render"');
});

test("tags an external module script whatever order its attributes come in", () => {
  const { html, tagged } = addRenderBlocking(
    '<script crossorigin src="/assets/a.js" type="module"></script>' +
      '<script type="module" crossorigin src="/assets/b.js"></script>',
  );
  expect(tagged).toBe(2);
  expect(html.match(/blocking="render"/gu)).toHaveLength(2);
});

test("leaves an inline module, a classic script and an already-blocking tag alone", () => {
  const input =
    '<script type="module">import "/x.js";</script>' +
    '<script src="/classic.js"></script>' +
    '<script type="module" blocking="render" src="/assets/c.js"></script>';
  expect(addRenderBlocking(input)).toEqual({ html: input, tagged: 0 });
});

test("fails the build when there is no entry to mark, instead of doing nothing", () => {
  expect(() => runHook("<!doctype html><html><head></head><body></body></html>")).toThrow(
    /no external module script/u,
  );
});
