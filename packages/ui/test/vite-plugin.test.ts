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

// Gate 2's N1 (repo-131): the plugin read the text, not the document. Each case
// below is a row of its population, run against the plugin at 3eb342af, where
// it was wrong, and against the fix.

test("leaves a module script on another origin alone, and marks the local entry beside it", () => {
  const remote = '<script type="module" src="https://cdn.example.test/x.js"></script>';
  const protocolRelative = '<script type="module" src="//cdn.example.test/x.js"></script>';
  const backslash = '<script type="module" src="/\\cdn.example.test/x.js"></script>';
  const local = '<script type="module" src="/assets/index-a.js"></script>';
  const out = addRenderBlocking(remote + protocolRelative + backslash + local);
  expect(out.tagged).toBe(1);
  expect(out.html).toBe(
    remote +
      protocolRelative +
      backslash +
      '<script blocking="render" type="module" src="/assets/index-a.js"></script>',
  );
});

test("marks a relative and a root-path src, not a scheme", () => {
  const { tagged } = addRenderBlocking(
    '<script type="module" src="./a.js"></script>' +
      '<script type="module" src="assets/b.js"></script>' +
      '<script type="module" src="/c.js"></script>' +
      '<script type="module" src="data:text/javascript,1"></script>' +
      '<script type="module" src="http://x.test/d.js"></script>',
  );
  expect(tagged).toBe(3);
});

test("a real vite build leaves a remote module script unmarked", async () => {
  const root = fixture(
    '<!doctype html><html><head><script type="module" src="https://cdn.example.test/x.js"></script>' +
      '<script type="module" src="/main.js"></script></head><body></body></html>',
  );
  const outDir = path.join(root, "dist");
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [renderBlockingEntry() as Plugin],
    build: { outDir, emptyOutDir: true, rollupOptions: { external: [/^https?:/u] } },
  });
  const built = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
  const scripts = [...built.matchAll(/<script\b[^>]*>/giu)].map((match) => match[0]);
  const remote = scripts.filter((tag) => tag.includes("cdn.example.test"));
  const local = scripts.filter((tag) => tag.includes("/assets/"));
  expect(remote).toHaveLength(1);
  expect(remote[0]).not.toContain("blocking");
  expect(local).toHaveLength(1);
  expect(local[0]).toContain('blocking="render"');
});

test("does not mark a script inside an HTML comment", () => {
  const commented = '<!-- <script type="module" src="/main.js"></script> -->';
  const real = '<script type="module" src="/assets/index-a.js"></script>';
  expect(addRenderBlocking(commented)).toEqual({ html: commented, tagged: 0 });
  const out = addRenderBlocking(commented + real);
  expect(out.tagged).toBe(1);
  expect(out.html).toBe(
    commented + '<script blocking="render" type="module" src="/assets/index-a.js"></script>',
  );
});

test("a page whose only module script is commented out fails the build", () => {
  expect(() =>
    runHook(
      '<!doctype html><html><head><!-- <script type="module" src="/main.js"></script> --></head></html>',
    ),
  ).toThrow(/no external module script/u);
});

test("a blocking attribute on a link, or in a comment, does not pass the guard", () => {
  const link = '<link rel="stylesheet" href="/a.css" blocking="render">';
  expect(() => runHook(`<!doctype html><html><head>${link}</head></html>`)).toThrow(
    /no external module script/u,
  );
  expect(() =>
    runHook('<!doctype html><html><head><!-- <link blocking="render"> --></head></html>'),
  ).toThrow(/no external module script/u);
  // The same link beside a real entry: the entry is marked, the link untouched.
  const out = runHook(
    `<!doctype html><html><head>${link}<script type="module" src="/assets/index-a.js"></script></head></html>`,
  );
  expect(out).toContain(link);
  expect(out).toContain('<script blocking="render" type="module" src="/assets/index-a.js">');
});

test("a page whose only module script is on another origin fails the build", () => {
  expect(() =>
    runHook(
      '<!doctype html><html><head><script type="module" src="https://cdn.example.test/x.js"></script></head></html>',
    ),
  ).toThrow(/no external module script/u);
});

test("a blocking script that is not a module entry does not pass the guard", () => {
  expect(() =>
    runHook(
      '<!doctype html><html><head><script src="/classic.js" blocking="render"></script></head></html>',
    ),
  ).toThrow(/no external module script/u);
});

test("an entry that already carries blocking passes the guard and is left alone", () => {
  const page =
    '<!doctype html><html><head><script type="module" blocking="render" src="/assets/index-a.js"></script></head></html>';
  expect(runHook(page)).toBe(page);
});

test("matches attribute names whole: data-src is not src, data-type is not type", () => {
  const inline = '<script type="module" data-src="/x.js">inline()</script>';
  const classic = '<script data-type="module" src="/x.js"></script>';
  expect(addRenderBlocking(inline + classic)).toEqual({ html: inline + classic, tagged: 0 });
});

test("matches the script element, not a longer tag name", () => {
  const input = '<script-x type="module" src="/x.js"></script-x>';
  expect(addRenderBlocking(input)).toEqual({ html: input, tagged: 0 });
});

test("reads quoted and unquoted attributes the way a browser does", () => {
  const { html, tagged } = addRenderBlocking(
    "<script type='module' src='/a.js'></script>" +
      "<script type=module src=/b.js></script>" +
      '<script type="module" src="/c.js" nonblocking="x"></script>' +
      '<script type="module" src="/d.js" data-note="a > b"></script>',
  );
  expect(tagged).toBe(4);
  expect(html.match(/<script blocking="render"/gu)).toHaveLength(4);
});
