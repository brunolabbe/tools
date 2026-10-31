// @vitest-environment jsdom

/**
 * The footer (repo-131): the version the bundle was built at, as text, and the
 * Terms link — nothing that points at GitHub (owner, 2026-10-31).
 */

import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppFooter } from "../src/AppFooter.tsx";
import { TOOL_VERSION } from "../src/version.ts";

afterEach(cleanup);

test("the version is shown as text, and Terms is the only link", () => {
  render(<AppFooter version="0.10.0" termsHref="/terms.html" />);

  expect(screen.getByText("0.10.0").closest("a")).toBeNull();
  const links = screen.getAllByRole("link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual(["/terms.html"]);
  expect(links[0]?.textContent).toBe("Terms");
});

test("an unknown version is left out rather than printed", () => {
  render(<AppFooter version="unknown" termsHref="/terms.html" />);

  expect(screen.getByRole("contentinfo").textContent).toBe("Terms");
});

test("with no build-time define, the version is unknown rather than a ReferenceError", () => {
  // vitest runs no tool's `vite.config.ts`, so `__TOOL_VERSION__` is undeclared here.
  expect(TOOL_VERSION).toBe("unknown");
});
