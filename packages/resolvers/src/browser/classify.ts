/**
 * Why we found nothing.
 *
 * This resolver runs on everything unusual, so a vague error here makes the
 * whole product feel broken. Only `NO_MEDIA_FOUND` lets the registry fall
 * through to another resolver; everything else stops the chain, so each verdict
 * needs to be one we would defend.
 */

import { AppError, redactUrl } from "@downloader/shared";

/** Everything the classifier is allowed to look at. Gathered once, in-page. */
export interface PageSignals {
  finalUrl: string;
  /** Status of the main navigation response, when there was one. */
  status?: number | undefined;
  title: string;
  bodyText: string;
  html: string;
  hasPasswordInput: boolean;
  hasPlayerElement: boolean;
  /** False when the deadline ran out with the page still fetching. */
  quietReached: boolean;
}

const BOT_MARKERS: readonly string[] = [
  "cf-browser-verification",
  "cf_chl_opt",
  "__cf_chl",
  "cf-challenge",
  "checking your browser before accessing",
  "just a moment...",
  "attention required! | cloudflare",
  "enable javascript and cookies to continue",
  "verify you are human",
  "verifying you are human",
  "please verify you are a human",
  "datadome",
  "captcha-delivery.com",
  "px-captcha",
  "perimeterx",
  "_pxhd",
  "access to this page has been denied",
  "_incapsula_resource",
  "incapsula incident id",
  "request unsuccessful. incapsula",
];

const AUTH_PATH =
  /\/(?:login|log-in|log_in|signin|sign-in|sign_in|auth|authorize|oauth|sso|session\/new|account\/login|users\/sign_in)(?:[/.?]|$)/i;

const AUTH_MARKERS: readonly string[] = [
  "sign in to continue",
  "sign in to watch",
  "log in to continue",
  "log in to watch",
  "you must be logged in",
  "please log in to view",
  "members only",
  "subscribers only",
];

const GEO_MARKERS: readonly string[] = [
  "not available in your country",
  "not available in your region",
  "not available in your location",
  "unavailable in your country",
  "unavailable in your region",
  "not available in your area",
  "geo-restricted",
  "geo restricted",
  "geoblocked",
  "geo-blocked",
  "this content is blocked in your country",
  "for copyright reasons",
  "n'est pas disponible dans votre pays",
  "nicht in deinem land verfügbar",
  "no está disponible en tu país",
];

function containsAny(haystack: string, needles: readonly string[]): string | undefined {
  for (const needle of needles) {
    if (haystack.includes(needle)) return needle;
  }
  return undefined;
}

export function classifyFailure(signals: PageSignals): AppError {
  const haystack = `${signals.title}\n${signals.bodyText}\n${signals.html}`.toLowerCase();
  const details: Record<string, unknown> = {
    url: redactUrl(signals.finalUrl),
    ...(signals.status === undefined ? {} : { status: signals.status }),
  };

  const botMarker = containsAny(haystack, BOT_MARKERS);
  if (botMarker !== undefined) {
    return new AppError("BOT_CHALLENGE", undefined, {
      details: { ...details, marker: botMarker },
    });
  }

  let finalPath = "";
  try {
    finalPath = new URL(signals.finalUrl).pathname;
  } catch {
    finalPath = "";
  }
  const authMarker = containsAny(haystack, AUTH_MARKERS);
  const loginRoute = AUTH_PATH.test(finalPath);
  // A password field where the player should be is a login wall, not a page
  // that merely happens to have a sign-in box in its header.
  const loginForm = signals.hasPasswordInput && !signals.hasPlayerElement;
  if (signals.status === 401 || loginRoute || loginForm || authMarker !== undefined) {
    return new AppError("AUTH_REQUIRED", undefined, {
      details: {
        ...details,
        ...(loginRoute ? { reason: "login-route" } : {}),
        ...(loginForm ? { reason: "login-form" } : {}),
        ...(authMarker === undefined ? {} : { marker: authMarker }),
      },
    });
  }

  const geoMarker = containsAny(haystack, GEO_MARKERS);
  if (signals.status === 451 || geoMarker !== undefined) {
    return new AppError("GEO_BLOCKED", undefined, {
      details: { ...details, ...(geoMarker === undefined ? {} : { marker: geoMarker }) },
    });
  }

  if (signals.status !== undefined && signals.status >= 400) {
    return new AppError("UNREACHABLE", `The site answered with HTTP ${signals.status}.`, {
      details,
    });
  }

  if (!signals.quietReached) {
    return new AppError("TIMEOUT", "The page was still loading when the time budget ran out.", {
      details,
    });
  }

  // The page loaded, settled, and asked for no media. This is the one verdict
  // that lets the registry try another resolver.
  return new AppError("NO_MEDIA_FOUND", undefined, { details });
}

/** Navigation never completed: DNS, TLS, connection or protocol level. */
export function classifyNavigationError(error: unknown, url: string): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) {
    return new AppError("TIMEOUT", "The page took too long to load.", {
      cause: error,
      details: { url: redactUrl(url) },
    });
  }
  return new AppError("UNREACHABLE", undefined, {
    cause: error,
    details: { url: redactUrl(url), reason: message.split("\n")[0] ?? message },
  });
}
