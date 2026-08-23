// @vitest-environment jsdom

/**
 * The unknown-total rule, held to at the element that decides it.
 *
 * **Why the environment is a docblock rather than a project.** The `downloader`
 * vitest project collects every suite under the tool and is `environment: "node"`,
 * which is right: the engine, the resolvers and the API have no business paying
 * for a DOM, and a browser-sniffer suite that booted jsdom for nothing would be
 * slower for no answer. Vitest 4 removed `environmentMatchGlobs`, so the two ways
 * to give this file a DOM are the line above or a project of its own — and a
 * second project would have to be carved back out of the `downloader` glob to
 * stop both collecting these files, which is the "two owners, no authoritative
 * answer" shape `tsconfig.tests.json` already warns about for the compiler. One
 * line at the top of each file that needs it, and the tool's suite stays one
 * project. It is also what pl-12 chose for the planner, so the two `web` suites
 * read the same way.
 *
 * `ProgressBar` is a native `<progress>`, so "indeterminate" is not a class name
 * this suite can agree with itself about: it is the element having no `value`,
 * which the DOM reports as `position === -1` and which assistive technology
 * reads as a busy bar with no figure. Both are asserted, along with the accessible
 * name, because the name is the only part of it a screen-reader user gets.
 */

import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProgressBar } from "../src/components/ProgressBar.tsx";

// Explicit, not automatic: `globals: false` means Testing Library never registers
// its own afterEach, and a second render would find two bars in the document.
afterEach(cleanup);

function bar(): HTMLProgressElement {
  const element = screen.getByRole("progressbar");
  expect(element).toBeInstanceOf(HTMLProgressElement);
  return element as HTMLProgressElement;
}

test("a null total renders an indeterminate bar, and never a figure", () => {
  render(<ProgressBar percent={null} label="Downloading" />);

  const element = bar();
  // The whole rule, three ways: no `value` attribute, the DOM's own answer for
  // an indeterminate bar, and a name that says so instead of naming a number.
  expect(element.hasAttribute("value")).toBe(false);
  expect(element.position).toBe(-1);
  expect(element.getAttribute("aria-label")).toBe("Downloading: in progress, total unknown");
  expect(element.getAttribute("aria-label")).not.toMatch(/\d/u);
});

test("a real zero is determinate, and is not the same render as an unknown total", () => {
  render(<ProgressBar percent={0} label="Downloading" />);

  const element = bar();
  expect(element.hasAttribute("value")).toBe(true);
  expect(element.value).toBe(0);
  expect(element.position).toBe(0);
  expect(element.getAttribute("aria-label")).toBe("Downloading: 0 percent");
});

test("a known percentage is announced, with the speed when there is one", () => {
  render(<ProgressBar percent={41.6} label="Downloading" valueText="12.4 MB/s" />);

  const element = bar();
  expect(element.value).toBeCloseTo(41.6);
  expect(element.max).toBe(100);
  expect(element.getAttribute("aria-label")).toBe("Downloading: 42 percent, 12.4 MB/s");
});

test("a percentage outside 0–100 is clamped rather than rendered", () => {
  render(<ProgressBar percent={140} label="Assembling" />);
  expect(bar().value).toBe(100);
  cleanup();

  render(<ProgressBar percent={-8} label="Assembling" />);
  expect(bar().value).toBe(0);
});
