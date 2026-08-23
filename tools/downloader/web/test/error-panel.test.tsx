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
 *
 * The second claim is the one dl-15 added rather than found: **a retry the user
 * cannot yet make must say when they can.** `retryAfterSec` reaches the client
 * inside `details`, and until this ticket nothing read it — the panel offered a
 * button and no answer to "when?", which is the never-fake-progress rule failing
 * from the other direction. `presentError` now surfaces it and the panel renders
 * it, and only when the server actually supplied one.
 */

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_ERROR_MESSAGES, ERROR_CODES } from "@downloader/contract";
import type { AppErrorPayload } from "@downloader/contract";
import { ErrorPanel } from "../src/components/ErrorPanel.tsx";
import { ERROR_PRESENTATION, presentError } from "../src/lib/error-presentation.ts";
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

test("a retryable rate limit offers the retry, and says when", () => {
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

  // "Try again" with no answer to "when?" is the same failure as an invented
  // progress total: the UI was told and did not say.
  expect(within(notice).getByText("Wait 20 s before trying again.")).toBeDefined();

  fireEvent.click(within(notice).getByRole("button", { name: "Analyse again" }));
  expect(spies.onRetry).toHaveBeenCalledOnce();
});

test("a long wait is given in minutes, rounded up", () => {
  mount(errorPayload("RATE_LIMITED", { retryable: true, details: { retryAfterSec: 90 } }));
  expect(screen.getByText("Wait 2 min before trying again.")).toBeDefined();
});

test("no wait is rendered when the server did not supply one", () => {
  // The rest of `details` is not the UI's to read, and an absent, zero or
  // nonsense value produces no line rather than a guessed one.
  for (const details of [
    undefined,
    { scope: "probe-gate" },
    { retryAfterSec: 0 },
    { retryAfterSec: -30 },
    { retryAfterSec: "soon" },
  ]) {
    mount(errorPayload("RATE_LIMITED", { retryable: true, ...(details ? { details } : {}) }));
    expect(screen.queryByText(/before trying again/u)).toBeNull();
    // The retry itself is still offered — the wait is extra information, not a
    // precondition for showing the button.
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    cleanup();
  }
});

test("a hard stop never carries a wait, whatever the payload attached", () => {
  // The hazard this file exists to prevent, in its second form. `details` is
  // server-supplied and a server can put `retryAfterSec` on any code — so a DRM
  // refusal could arrive carrying one, and the panel would print "there is
  // nothing to retry — the answer will not change" directly above "wait 20 s
  // before trying again".
  //
  // Vetoed in `presentError`, not gated in the panel: one place decides, the
  // same place that vetoes the retry button, so no future renderer of an
  // `ErrorView` can reintroduce the contradiction.
  mount(errorPayload("DRM_PROTECTED", { retryable: true, details: { retryAfterSec: 20 } }));

  const notice = screen.getByRole("status");
  expect(within(notice).getByText(/There is nothing to retry/u)).toBeDefined();
  expect(screen.queryByText(/before trying again/u)).toBeNull();
  expect(within(notice).queryByRole("button")).toBeNull();
});

test("no code the taxonomy refuses to retry can show a wait", () => {
  // Not just DRM. Every `allowRetry: false` entry, handed the same hostile
  // payload — because the veto is a property of the table, not of one code.
  for (const code of ERROR_CODES) {
    if (ERROR_PRESENTATION[code].allowRetry) continue;
    const view = presentError(
      errorPayload(code, { retryable: true, details: { retryAfterSec: 20 } }),
    );
    expect(view.retryAfterSec).toBeNull();

    mount(errorPayload(code, { retryable: true, details: { retryAfterSec: 20 } }));
    expect(screen.queryByText(/before trying again/u)).toBeNull();
    cleanup();
  }
});

test("a wait is shown even where there is nothing to press", () => {
  // A panel with no `onRetry` still tells the user the server is busy for
  // another twenty seconds, which is true and useful on its own.
  mount(errorPayload("RATE_LIMITED", { retryable: true, details: { retryAfterSec: 20 } }), {
    retry: false,
  });

  expect(screen.getByText("Wait 20 s before trying again.")).toBeDefined();
  expect(screen.queryByRole("button")).toBeNull();
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
