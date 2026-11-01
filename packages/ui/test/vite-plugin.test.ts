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
  const entries = [...built.matchAll(/<script\b[^>]*>/giu)].map((match) => match[0]);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatch(/\bsrc="\/assets\/[^"]+\.js"/u);
  expect(entries[0]).toContain('blocking="render"');
});

test("tags an external module script whatever order its attributes come in", () => {
  const { html, tagged } = addRenderBlocking(
    '<script crossorigin src="/assets/a.js" type="module"></script>' +
      '<script type="module" crossorigin src="/assets/b.js"></script>' +
      '<SCRIPT type="module" src="/assets/c.js"></SCRIPT>',
  );
  expect(tagged).toBe(3);
  expect(html.match(/blocking="render"/gu)).toHaveLength(3);
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

// repo-133: the plugin reads the document, not the text. Rows are the ticket's
// probe (`P8`..`P16`, `D1`, `D2`); each of these fails on the regexp the plugin
// had before, which read all of them as markup.

const REMOTE = '<script type="module" src="https://cdn.example.test/x.js"></script>';
const ENTRY = '<script type="module" src="/main.js"></script>';

function page(head: string): string {
  return `<!doctype html><html><head>${head}</head><body></body></html>`;
}

/** A real build with a remote origin external, then each script tag as `[src, marked]`. */
async function builtScripts(html: string): Promise<Array<[string | undefined, boolean]>> {
  const root = fixture(html);
  const outDir = path.join(root, "dist");
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [renderBlockingEntry() as Plugin],
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { external: [/^https?:/u, /^\/\//u] },
    },
  });
  const built = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
  return [...built.matchAll(/<script\b[^>]*>/giu)].map((match) => [
    /\ssrc="([^"]*)"/u.exec(match[0])?.[1],
    /\sblocking="render"/u.test(match[0]),
  ]);
}

test("P8: a remote module script beside the entry stays unmarked; the entry is marked", async () => {
  const scripts = await builtScripts(page(REMOTE + ENTRY));
  expect(scripts.map(([src, marked]) => [src?.startsWith("/assets/") ?? false, marked])).toEqual([
    [false, false],
    [true, true],
  ]);
});

test("P9: a remote module script only: the build passes on Vite's helper, the remote stays unmarked", async () => {
  const scripts = await builtScripts(page(REMOTE));
  const remote = scripts.find(([src]) => src?.startsWith("https://"));
  const helper = scripts.find(([src]) => src?.startsWith("/assets/"));
  expect(remote?.[1]).toBe(false);
  expect(helper?.[1]).toBe(true);
});

test.each([
  ["P10", "an HTML comment", `<!-- ${ENTRY} -->`],
  ["P11", "an unterminated comment", `<!-- ${ENTRY}`],
  ["P12", "<title>", `<title>${ENTRY}</title>`],
  ["P13", "<textarea>", `<textarea>${ENTRY}</textarea>`],
  ["P14", "a script's string", `<script>var s = '${ENTRY}';</script>`],
  [
    "P16",
    "a comment, beside a blocking link",
    `<!-- ${ENTRY} --><link rel="stylesheet" href="/a.css" blocking="render">`,
  ],
])("%s: the entry as text in %s fails the guard", (_row, _where, head) => {
  expect(() => runHook(page(head))).toThrow(/no external module script/u);
  expect(addRenderBlocking(page(head)).tagged).toBe(0);
});

test("P15: an entity-encoded remote src is read as the remote it is, and stays unmarked", async () => {
  const src = "&#47;&#47;cdn.example.test/x.js";
  const input = page(`<script type="module" src="${src}"></script>`);
  expect(addRenderBlocking(input)).toEqual({ html: input, tagged: 0 });
  const scripts = await builtScripts(input);
  expect(scripts.find(([found]) => found?.startsWith("/assets/"))?.[1]).toBe(true);
  expect(scripts.find(([found]) => found?.startsWith("&#47;"))?.[1]).toBe(false);
});

test("D1: a module script with data-src and no src is not an external module script", () => {
  const input = '<script type="module" data-src="/x.js">inline()</script>';
  expect(addRenderBlocking(input)).toEqual({ html: input, tagged: 0 });
});

test("D2: <script-x> is not a script", () => {
  const input = '<script-x type="module" src="/x.js"></script-x>';
  expect(addRenderBlocking(input)).toEqual({ html: input, tagged: 0 });
});

test("a remote origin in any spelling a browser reads as one is left alone", () => {
  for (const src of [
    "https://cdn.example.test/x.js",
    "//cdn.example.test/x.js",
    "\\\\cdn.example.test/x.js",
    " \t//cdn.example.test/x.js",
    "data:text/javascript,1",
  ]) {
    const input = `<script type="module" src="${src}"></script>`;
    expect(addRenderBlocking(input).tagged, src).toBe(0);
  }
  for (const src of ["/a.js", "a.js", "./a.js", "../a.js", "/a.js?x=//y"]) {
    const input = `<script type="module" src="${src}"></script>`;
    expect(addRenderBlocking(input).tagged, src).toBe(1);
  }
});

test("offsets stay right past CRLF, astral characters and an earlier tag", () => {
  const { html, tagged } = addRenderBlocking(
    `<!-- \u{1F600}\r\n -->\r\n<script type="module" src="/a.js"></script>\r\n<script type="module" src="/b.js"></script>`,
  );
  expect(tagged).toBe(2);
  expect(html).toBe(
    `<!-- \u{1F600}\r\n -->\r\n<script blocking="render" type="module" src="/a.js"></script>\r\n<script blocking="render" type="module" src="/b.js"></script>`,
  );
});

test("a template's script is inert and is not an entry", () => {
  const input = `<template>${ENTRY}</template>`;
  expect(addRenderBlocking(input)).toEqual({ html: input, tagged: 0 });
});
