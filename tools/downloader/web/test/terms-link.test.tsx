// @vitest-environment jsdom

/**
 * dl-54: the UI links to the terms page, and the page is where the bundle puts
 * it.
 *
 * `public/terms.html` is a static file, not a route: Vite copies it into the
 * bundle's root, `@fastify/static` serves it same-origin, and the document
 * policy, which allows `'self'` for scripts and styles, needs no change for it.
 * So the link has to be a plain `href` to a path that exists beside `index.html`.
 * See `progress-bar.test.tsx` for why the DOM arrives as a docblock, and
 * `app.test.tsx` for why the client is replaced rather than `fetch`.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ApiClient } from "../src/api/types.ts";

afterEach(() => {
  cleanup();
  vi.doUnmock("../src/api/client.ts");
  vi.resetModules();
});

test("the footer links to a terms page that is a file in public/", async () => {
  vi.resetModules();
  const client = {
    probe: vi.fn(),
    createJob: vi.fn(),
    getJob: vi.fn(),
    cancelJob: vi.fn(),
    openJobEvents: vi.fn(() => ({ close: vi.fn() })),
    openProbeEvents: vi.fn(() => ({ close: vi.fn() })),
  } satisfies ApiClient;
  vi.doMock("../src/api/client.ts", () => ({ USING_MOCK_API: false, api: client }));
  const { App } = await import("../src/App.tsx");
  render(<App />);

  const link = screen.getByRole("link", { name: /terms/iu });
  const href = link.getAttribute("href");
  expect(href).toBe("/terms.html");
  // Same-origin by construction: a path, never an absolute URL, so the document
  // policy's `'self'` is what governs it.
  expect(href?.startsWith("/")).toBe(true);
  // A path and not a `URL`: jsdom's `URL` is not the one `node:fs` accepts.
  const here = path.dirname(fileURLToPath(import.meta.url));
  expect(existsSync(path.join(here, "..", "public", href?.slice(1) ?? ""))).toBe(true);
});
