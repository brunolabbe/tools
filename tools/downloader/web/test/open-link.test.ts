// @vitest-environment jsdom

/**
 * The real transport's `openLink`: the job card's `<a href download>`, clicked
 * on the visitor's behalf so one press of the panel's Download starts the file.
 * See `progress-bar.test.tsx` for why the DOM arrives as a docblock.
 */

import { afterEach, expect, test } from "vitest";
import { createHttpClient } from "../src/api/http.ts";
import { LINK } from "./fixtures.ts";

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
});

test("opens the link as a download and leaves nothing behind in the page", () => {
  const clicked: { href: string | null; download: string | null; attached: boolean }[] = [];
  const listener = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement)) return;
    clicked.push({
      href: target.getAttribute("href"),
      download: target.getAttribute("download"),
      attached: target.isConnected,
    });
    event.preventDefault();
  };
  document.addEventListener("click", listener);
  stop = () => document.removeEventListener("click", listener);

  createHttpClient().openLink(LINK.url);

  // `download` present and empty, so the name comes from `Content-Disposition`
  // and a refusal does not navigate the page away from the card (dl-77).
  expect(clicked).toEqual([{ href: LINK.url, download: "", attached: true }]);
  expect(document.querySelectorAll("a")).toHaveLength(0);
});
