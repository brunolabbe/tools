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

/** A module script with a `src`, which is how Vite writes a built entry's tag. */
const ENTRY_TAG = /<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc=)(?![^>]*\bblocking=)[^>]*>/giu;

/**
 * Adds `blocking="render"` to every external module script in the built HTML
 * that lacks one. Exported apart from the plugin so a test can feed it Vite's
 * output directly. Returns the HTML and how many tags it changed.
 */
export function addRenderBlocking(html: string): { html: string; tagged: number } {
  let tagged = 0;
  const out = html.replace(ENTRY_TAG, (tag) => {
    tagged += 1;
    return tag.replace(/^<script\b/iu, '<script blocking="render"');
  });
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
        if (tagged === 0 && !/\bblocking="render"/u.test(html)) {
          this.error(
            'render-blocking-entry: no external module script in the built HTML to mark blocking="render"',
          );
        }
        return out;
      },
    },
  };
}
