// @vitest-environment jsdom

/**
 * The panel every failure in this product arrives through, against real payloads
 * from the taxonomy rather than invented ones.
 *
 * See `progress-bar.test.tsx` for why the DOM arrives as a docblock rather than
 * a vitest project of its own.
 *
 * `error-presentation.test.ts` already proves the table has copy for every code
 * and that `presentError` resolves the right entry. What it cannot see is
 * whether any of that reaches the screen — which role the notice takes, whether
 * the retry affordance is rendered, whether the code is shown at all. That is
 * this file.
 *
 * **The one claim worth stating plainly: `retryable` on the payload is server
 * data and must never, on its own, put a "Try again" button in front of a hard
 * stop.** `presentError` ands it with the table's own `allowRetry`, and a DRM
 * refusal with `retryable: true` forced on it is the test that says so.
 */

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_ERROR_MESSAGES } from "@downloader/contract";
import type { AppErrorPayload } from "@downloader/contract";
import { ErrorPanel } from "../src/components/ErrorPanel.tsx";
import { errorPayload } from "./fixtures.ts";

afterEach(cleanup);

interface Spies {
  onRetry: ReturnType<typeof vi.fn<() => void>>;
  onDismiss: ReturnType<typeof vi.fn<() => void>>;
}

function mount(
  error: AppErrorPayload,
  options: { retry?: boolean; dismiss?: boolean; retryLabel?: string } = {},
): Spies {
  const spies: Spies = { onRetry: vi.fn<() => void>(), onDismiss: vi.fn<() => void>() };
  render(
    <ErrorPanel
      error={error}
      {...(options.retry === false ? {} : { onRetry: spies.onRetry })}
      {...(options.dismiss ? { onDismiss: spies.onDismiss } : {})}
      {...(options.retryLabel ? { retryLabel: options.retryLabel } : {})}
    />,
  );
  return spies;
}

test("DRM is presented as an answer, with no retry to press", () => {
  // The hard stop from this tool's CLAUDE.md. `retryable` is forced true here
  // on purpose: it is what a careless server could send, and the client veto in
  // `ERROR_PRESENTATION` is what must still keep the button off the screen.
  mount(errorPayload("DRM_PROTECTED", { retryable: true }));

  // `final` in the table, so it is a status rather than an alert: an answer, not
  // an alarm.
  const notice = screen.getByRole("status");
  expect(within(notice).getByRole("heading", { name: "Protected by DRM" })).toBeDefined();
  expect(within(notice).getByText("DRM_PROTECTED")).toBeDefined();
  expect(within(notice).getByText(/Widevine, PlayReady or FairPlay/u)).toBeDefined();
  expect(within(notice).queryByRole("button")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a retryable rate limit offers the retry, and its own copy", () => {
  // What the API actually sends for a probe-gate refusal: `retryAfterSec` rides
  // in `details`, which `http-errors.ts` allowlists through to the client.
  const payload = errorPayload("RATE_LIMITED", {
    message: "The server is analysing as many pages as it can at once. Try again shortly.",
    retryable: true,
    details: { scope: "probe-gate", retryAfterSec: 20 },
  });
  const spies = mount(payload, { retryLabel: "Analyse again" });

  const notice = screen.getByRole("alert");
  expect(within(notice).getByRole("heading", { name: "Too many requests" })).toBeDefined();
  expect(within(notice).getByText(payload.message)).toBeDefined();

  fireEvent.click(within(notice).getByRole("button", { name: "Analyse again" }));
  expect(spies.onRetry).toHaveBeenCalledOnce();

  // Not asserted as a feature, recorded as the current answer: nothing renders
  // the wait. `details` is documented as "not rendered verbatim in the UI" and
  // `presentError` does not read it, so the panel says "try again" without
  // saying when. See this ticket's Log.
  expect(notice.textContent).not.toContain("20");
});

test("a retry the code does not allow is not offered, whatever the payload says", () => {
  // `AUTH_REQUIRED` is `allowRetry: false`: the source wants a signed-in
  // session and a second identical request will not produce one.
  mount(errorPayload("AUTH_REQUIRED", { retryable: true }), { dismiss: true });

  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeDefined();
});

test("a retryable code with no handler shows no button either", () => {
  mount(errorPayload("UNREACHABLE", { retryable: true }), { retry: false });
  expect(screen.queryByRole("button")).toBeNull();
});

test("dismiss reports upward and stands alone", () => {
  const spies = mount(errorPayload("INVALID_URL"), { dismiss: true });

  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(spies.onDismiss).toHaveBeenCalledOnce();
  expect(spies.onRetry).not.toHaveBeenCalled();
});

test("the payload's message wins, and an empty one falls back to the taxonomy's", () => {
  mount(errorPayload("NO_MEDIA_FOUND", { message: "Nothing plays on that page." }));
  expect(screen.getByText("Nothing plays on that page.")).toBeDefined();

  cleanup();
  mount(errorPayload("NO_MEDIA_FOUND", { message: "   " }));
  expect(screen.getByText(DEFAULT_ERROR_MESSAGES.NO_MEDIA_FOUND)).toBeDefined();
});

test("every panel names its code, so a bug report can quote one", () => {
  for (const code of ["VARIANT_GONE", "SIZE_LIMIT_EXCEEDED", "JOB_NOT_FOUND"] as const) {
    mount(errorPayload(code));
    expect(screen.getByText(code)).toBeDefined();
    cleanup();
  }
});
