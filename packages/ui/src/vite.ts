/**
 * Build-time helpers for a tool's `web/vite.config.ts` (repo-131). This module
 * runs in Node, inside Vite's config, and never reaches a browser bundle.
 *
 * Lifted from the downloader on its second consumer, the ledger (owner,
 * 2026-10-31). repo-5 kept the configs' `HOST` block out of a package because a
 * built dependency with no `dist` stops Vite before it starts; this package
 * exports source, so a config that imports it needs no build step first.
 */

import { html as parse5Html, parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import type { Plugin } from "vite";

type Node = DefaultTreeAdapterMap["node"];

/**
 * Any origin will do for the test; this one is never fetched. A `src` resolved
 * against it keeps this origin only if a browser would fetch it from the page's
 * own origin, which also covers `//host`, `\\host`, a `data:` URL and the
 * whitespace a URL parser strips.
 */
const PAGE = new URL("http://webtools.invalid/");

/** Does a browser read this `src` as the page's own origin? */
function sameOrigin(src: string): boolean {
  try {
    return new URL(src, PAGE).origin === PAGE.origin;
  } catch {
    return false;
  }
}

interface Entry {
  /** The offset just after `<script`, where an attribute can be written. */
  at: number;
  /** Whether the tag already has a `blocking` attribute. */
  blocking: boolean;
}

/**
 * Every same-origin `<script type="module" src>` in the document, as the HTML
 * standard reads it, in document order. What a browser reads as text (a
 * comment, an unterminated comment, `<title>`, `<textarea>`, a script's string)
 * is text here, and a character reference in `src` is decoded before the origin
 * test.
 *
 * The document is parsed rather than matched: a regular expression over the
 * string read all of that as markup, and a repeated opener with no `>` to close
 * it took time quadratic in the input (repo-133).
 */
function entries(html: string): Entry[] {
  const found: Entry[] = [];
  // A `<template>`'s content is not in `childNodes`, which is right: its
  // scripts never run. The stack is explicit so deeply nested input cannot
  // overflow the call stack.
  const stack: Node[] = [parse(html, { sourceCodeLocationInfo: true })];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if ("childNodes" in node) stack.push(...node.childNodes);
    if (
      node.nodeName !== "script" ||
      !("attrs" in node) ||
      node.namespaceURI !== parse5Html.NS.HTML
    ) {
      continue;
    }
    const value = (name: string): string | undefined =>
      node.attrs.find((attr) => attr.name === name)?.value;
    const src = value("src");
    if (value("type")?.toLowerCase() !== "module" || src === undefined || src === "") continue;
    const start = node.sourceCodeLocation?.startTag;
    if (start === undefined || !sameOrigin(src)) continue;
    found.push({
      at: start.startOffset + "<script".length,
      blocking: value("blocking") !== undefined,
    });
  }
  return found.toSorted((a, b) => a.at - b.at);
}

/**
 * `entries` counts every same-origin external module script the document has,
 * marked now or before, which is what the build's guard reads.
 */
function mark(html: string): { html: string; tagged: number; entries: number } {
  const all = entries(html);
  let out = html;
  let tagged = 0;
  // Last offset first, so an insertion does not move the ones before it.
  for (const entry of all.toReversed()) {
    if (entry.blocking) continue;
    out = `${out.slice(0, entry.at)} blocking="render"${out.slice(entry.at)}`;
    tagged += 1;
  }
  return { html: out, tagged, entries: all.length };
}

/**
 * Adds `blocking="render"` to every same-origin external module script in the
 * built HTML that has no `blocking` attribute. Returns the HTML and how many
 * tags it changed. Exported apart from the plugin so a test can feed it Vite's
 * output directly.
 *
 * A remote module script (`https://…`, `//…`) is the page's dependency on
 * someone else's code, and its tag is left as the author wrote it.
 */
export function addRenderBlocking(html: string): { html: string; tagged: number } {
  const { html: out, tagged } = mark(html);
  return { html: out, tagged };
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
 * **It fails the build rather than doing nothing.** It looks for the tag Vite
 * writes, so a change in how Vite writes it would otherwise leave the page
 * painting before its theme, which only the e2e suite would notice. It counts
 * any same-origin module script, not only the app's entry: Vite's own
 * modulepreload helper is one, so a page whose only same-origin module script
 * is that helper passes (repo-133, Decision 2).
 */
export function renderBlockingEntry(): Plugin {
  return {
    name: "webtools-render-blocking-entry",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const { html: out, entries: found } = mark(html);
        if (found === 0) {
          this.error(
            'render-blocking-entry: no external module script on the same origin in the built HTML to mark blocking="render"',
          );
        }
        return out;
      },
    },
  };
}
