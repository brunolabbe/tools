// @vitest-environment jsdom

/**
 * The footer's three links (repo-131): the release the bundle was built at,
 * the changelog when it does not know, and the tool's source.
 */

import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppFooter } from "../src/AppFooter.tsx";
import { REPOSITORY_URL } from "../src/repository.ts";
import { TOOL_VERSION } from "../src/version.ts";

afterEach(cleanup);

test("the version links to that tool's release, tagged <tool>-v<version>", () => {
  render(<AppFooter tool="planner" version="0.10.0" termsHref="/terms.html" />);

  const version = screen.getByRole("link", { name: "v0.10.0" });
  expect(version.getAttribute("href")).toBe(
    "https://github.com/brunolabbe/tools/releases/tag/planner-v0.10.0",
  );
});

test("an unknown version links to the tool's changelog instead", () => {
  render(<AppFooter tool="ledger" version="unknown" termsHref="/terms.html" />);

  const changelog = screen.getByRole("link", { name: "Changelog" });
  expect(changelog.getAttribute("href")).toBe(
    "https://github.com/brunolabbe/tools/blob/main/tools/ledger/CHANGELOG.md",
  );
  expect(screen.queryByText(/vunknown/u)).toBeNull();
});

test("Source links to the tool's directory, and Terms to the page it is given", () => {
  render(<AppFooter tool="downloader" version="1.2.3" termsHref="/terms.html" />);

  expect(screen.getByRole("link", { name: "Source" }).getAttribute("href")).toBe(
    "https://github.com/brunolabbe/tools/tree/main/tools/downloader",
  );
  expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms.html");
  // Every outbound link is built from the one constant.
  expect(REPOSITORY_URL).toBe("https://github.com/brunolabbe/tools");
});

test("with no build-time define, the version is unknown rather than a ReferenceError", () => {
  // vitest runs no tool's `vite.config.ts`, so `__TOOL_VERSION__` is undeclared here.
  expect(TOOL_VERSION).toBe("unknown");
});
