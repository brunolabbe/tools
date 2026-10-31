/**
 * Build-time helpers for a tool's `web/vite.config.ts` (repo-131). This module
 * runs in Node, inside Vite's config, and never reaches a browser bundle; its
 * only import is a type.
 *
 * Lifted from the downloader on its second consumer, the ledger (owner,
 * 2026-10-31). repo-5 kept the configs' `HOST` block out of a package because a
 * built dependency with no `dist` stops Vite before it starts; this package
 * exports source, so a config that imports it needs no build step first.
 */

import type { Plugin } from "vite";

/**
 * An HTML comment, or a `<script>` start tag. One pattern, so a scan sees them
 * in document order and a script inside a comment is consumed with it. The tag
 * name must end at whitespace, `/` or `>`, so `<script-x` is not a script, and
 * a quoted attribute value may hold a `>`.
 */
const COMMENT_OR_SCRIPT = /<!--[\s\S]*?-->|<script(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/giu;

/** One attribute of a start tag: its name, then a double-quoted, single-quoted or bare value. */
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;

/** The attributes of a `<script` start tag, names lower-cased, first occurrence winning as in a browser. */
function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of tag.slice("<script".length).matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? "").toLowerCase();
    if (!found.has(name)) found.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return found;
}

/**
 * A `src` that loads from this page's own origin: a relative path or a root
 * path. A scheme, `//` and `/\` (which a browser reads as `//`) are another
 * origin, and a build must not hold the first paint on one. A tab or newline is
 * dropped first, as the URL parser drops it.
 */
function isSameOrigin(src: string): boolean {
  const url = src.replace(/[\t\n\r]/gu, "").trim();
  return (
    url !== "" &&
    !/^[a-z][a-z0-9+.-]*:/iu.test(url) &&
    !/^[/\\]{2}/u.test(url) &&
    !url.startsWith("\\")
  );
}

/**
 * A built entry is a `<script>` with `type="module"` and a same-origin `src`.
 * `blocking` says whether it already holds the paint (the token `render`);
 * `hasBlocking` is any `blocking` attribute at all, whose value is then the
 * author's and is left alone.
 */
function classify(tag: string): { entry: boolean; hasBlocking: boolean; blocking: boolean } {
  const attrs = attributes(tag);
  const entry =
    attrs.get("type")?.trim().toLowerCase() === "module" && isSameOrigin(attrs.get("src") ?? "");
  const value = attrs.get("blocking");
  return {
    entry,
    hasBlocking: value !== undefined,
    blocking: value !== undefined && value.toLowerCase().split(/\s+/u).includes("render"),
  };
}

/**
 * Adds `blocking="render"` to every same-origin external module script in the
 * built HTML that lacks a `blocking` attribute. Exported apart from the plugin
 * so a test can feed it Vite's output directly. Returns the HTML and how many
 * tags it changed.
 *
 * It reads start tags, not the document: a comment is skipped whole, and an
 * element's content is not parsed. That is enough for the page Vite writes.
 */
export function addRenderBlocking(html: string): { html: string; tagged: number } {
  let tagged = 0;
  const out = html.replace(COMMENT_OR_SCRIPT, (match) => {
    if (match.startsWith("<!--")) return match;
    const { entry, hasBlocking } = classify(match);
    if (!entry || hasBlocking) return match;
    tagged += 1;
    return `<script blocking="render"${match.slice("<script".length)}`;
  });
  return { html: out, tagged };
}

/** Whether an entry tag in the document holds the paint: the tag itself, not any `blocking="render"` on the page. */
function hasBlockingEntry(html: string): boolean {
  for (const match of html.matchAll(COMMENT_OR_SCRIPT)) {
    if (match[0].startsWith("<!--")) continue;
    const { entry, blocking } = classify(match[0]);
    if (entry && blocking) return true;
  }
  return false;
}

/**
 * Holds the first paint until the bundle's entry has run, so the theme it
 * applies before `createRoot` is on the page before the browser paints it.
 *
 * A module script is deferred, and without this Chromium painted the
 * downloader at 28 ms and its stored dark theme arrived at 68 ms. `blocking`
 * asks the engine to wait; whether it does is the engine's choice. Chromium
 * does, and the downloader's `e2e/csp.spec.ts` measures it; other engines are
 * not measured, and one that ignores the attribute may paint one light frame
 * (owner, 2026-10-31: Chromium accepted).
 *
 * Why a plugin: Vite writes the built entry's tag itself and drops the
 * attribute `index.html` gave it. Build only: the dev server keeps the
 * attribute from `index.html`, and its own client scripts are not the app's.
 *
 * **It fails the build rather than doing nothing.** It matches the tag Vite
 * writes, so a change in how Vite writes it would otherwise leave the page
 * painting before its theme, which only the e2e suite would notice.
 */
export function renderBlockingEntry(): Plugin {
  return {
    name: "webtools-render-blocking-entry",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const { html: out, tagged } = addRenderBlocking(html);
        if (tagged === 0 && !hasBlockingEntry(html)) {
          this.error(
            'render-blocking-entry: no external module script in the built HTML to mark blocking="render"',
          );
        }
        return out;
      },
    },
  };
}
