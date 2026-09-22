/**
 * The page's half of the human check (dl-50): one fresh Turnstile token per
 * request that needs one.
 *
 * **Just in time, never held.** A token is single-use and expires after five
 * minutes, and one analysis makes two checked calls — the probe, then the job
 * a person may start minutes later. So nothing here keeps a token between
 * calls: each `next()` resets the widget and executes it again, immediately
 * before the request it is for. Expiry is handled by never letting a token
 * live long enough to reach it.
 *
 * **Invisible unless Cloudflare asks.** The widget renders with
 * `appearance: "interaction-only"` and `execution: "execute"`, so it does
 * nothing until a request needs a token and shows nothing unless Cloudflare
 * wants a person to interact — then it draws itself in `.human-check`, a
 * fixed, empty host at the bottom of the viewport.
 *
 * **Loaded only when configured.** `GET /api/config` says whether the
 * deployment asks for a check. When it does not, Cloudflare's script is never
 * fetched, and a self-hoster's page contacts no third party at all. When that
 * read fails, no token is sent and the server decides: if it wanted one, the
 * answer is `HUMAN_CHECK_FAILED`, the same as for any missing token.
 *
 * The token is a credential. It goes from the widget's callback into the
 * request body and nowhere else — not UI state, not storage, not a log.
 */

import { AppError } from "@downloader/contract";
import type { ClientConfigResponse } from "@downloader/contract";

/** `render=explicit`: the widget is rendered here, not found by class name. */
export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Where the widget draws itself when a challenge needs a person. */
export const HUMAN_CHECK_HOST_CLASS = "human-check";

/** A fresh token per call, or `null` when this deployment asks for none. */
export interface HumanCheckTokens {
  next(): Promise<string | null>;
}

export type ReadClientConfig = () => Promise<ClientConfigResponse>;

/** How the transport builds its token source; see `createHttpClient`. */
export type HumanCheckFactory = (readConfig: ReadClientConfig) => HumanCheckTokens;

/** The options this file passes to `turnstile.render`, and no others. */
export interface TurnstileRenderOptions {
  sitekey: string;
  execution: "execute";
  appearance: "interaction-only";
  /** Deterministic failure: a person presses again, rather than the widget looping. */
  retry: "never";
  /** Every token is taken fresh, so a background refresh would only spend quota. */
  "refresh-expired": "never";
  callback: (token: string) => void;
  "error-callback": (code: string) => boolean;
  "timeout-callback": () => void;
}

/** The slice of Cloudflare's `window.turnstile` this file uses. */
export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | null | undefined;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** The transport's default: no config read, no script, no token. */
export const noHumanCheck: HumanCheckFactory = () => ({ next: async () => null });

export interface TurnstileCheckOptions {
  /** Injected in tests, which have no network to fetch Cloudflare's script over. */
  loadTurnstile?: () => Promise<TurnstileApi>;
}

function checkFailed(detail: string): AppError {
  // The contract's default message, deliberately: the person's next move is
  // the same whichever of these it was. `details` is for a debugger, and is
  // never rendered verbatim.
  return new AppError("HUMAN_CHECK_FAILED", undefined, { details: { turnstile: detail } });
}

/** Appends Cloudflare's script once, and resolves with the API it defines. */
export function loadTurnstileScript(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (window.turnstile !== undefined) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.addEventListener("load", () => {
      if (window.turnstile === undefined) reject(checkFailed("script-without-api"));
      else resolve(window.turnstile);
    });
    // An ad blocker, a network that cannot reach Cloudflare, or a CSP that
    // lost its widening — all end here, and all mean no token can be had.
    script.addEventListener("error", () => reject(checkFailed("script-failed")));
    document.head.append(script);
  });
}

interface Widget {
  take(): Promise<string>;
}

function renderWidget(api: TurnstileApi, siteKey: string): Widget {
  const host = document.createElement("div");
  host.className = HUMAN_CHECK_HOST_CLASS;
  document.body.append(host);

  let pending: { resolve: (token: string) => void; reject: (error: AppError) => void } | null =
    null;
  const settle = (outcome: { token: string } | { error: AppError }): void => {
    const waiting = pending;
    pending = null;
    if (waiting === null) return;
    if ("token" in outcome) waiting.resolve(outcome.token);
    else waiting.reject(outcome.error);
  };

  const widgetId = api.render(host, {
    sitekey: siteKey,
    execution: "execute",
    appearance: "interaction-only",
    retry: "never",
    "refresh-expired": "never",
    callback: (token) => settle({ token }),
    "error-callback": (code) => {
      settle({ error: checkFailed(`widget-error-${code}`) });
      // Handled: tells the widget not to log the error a second time itself.
      return true;
    },
    // A challenge that needed a person and was not answered in time. Without
    // this the request it was for would wait forever behind "Analysing".
    "timeout-callback": () => settle({ error: checkFailed("challenge-timeout") }),
  });
  if (typeof widgetId !== "string") {
    // Removed so the retry on the next request does not stack a second host.
    host.remove();
    throw checkFailed("render-failed");
  }

  let executed = false;
  return {
    take: () =>
      new Promise<string>((resolve, reject) => {
        pending = { resolve, reject };
        // In `execution: "execute"` mode a widget that already holds a token —
        // spent or not — ignores `execute`. Resetting first is what makes the
        // job's token a different one from the probe's.
        if (executed) api.reset(widgetId);
        executed = true;
        api.execute(widgetId);
      }),
  };
}

export function createTurnstileCheck(
  readConfig: ReadClientConfig,
  options: TurnstileCheckOptions = {},
): HumanCheckTokens {
  const loadTurnstile = options.loadTurnstile ?? loadTurnstileScript;

  // Both memoised on success only. A config read or a script load that failed
  // once is tried again on the next request, rather than disabling the check
  // for the life of the tab.
  let config: Promise<ClientConfigResponse["humanCheck"]> | null = null;
  let widget: Promise<Widget> | null = null;
  // One execution at a time: the widget holds one token and one pending
  // callback, so a second `next()` waits for the first rather than resetting
  // the widget out from under it.
  let line: Promise<unknown> = Promise.resolve();

  const humanCheck = (): Promise<ClientConfigResponse["humanCheck"]> => {
    config ??= readConfig().then(
      (response) => response.humanCheck,
      (error: unknown) => {
        config = null;
        throw error;
      },
    );
    return config;
  };

  const widgetFor = (siteKey: string): Promise<Widget> => {
    widget ??= loadTurnstile()
      .then((api) => renderWidget(api, siteKey))
      .catch((error: unknown) => {
        widget = null;
        throw error;
      });
    return widget;
  };

  return {
    async next() {
      let check: ClientConfigResponse["humanCheck"];
      try {
        check = await humanCheck();
      } catch {
        return null;
      }
      if (check === null) return null;

      const { siteKey } = check;
      const turn = line.then(async () => await (await widgetFor(siteKey)).take());
      line = turn.catch(() => undefined);
      return await turn;
    },
  };
}
