/**
 * The colour theme a visitor chose, kept in one cookie every tool reads
 * (repo-131).
 *
 * A cookie and not `localStorage`, because the tools are separate subdomains
 * (`downloader.oludoi.com`, `planner.oludoi.com`) and storage is per origin: a
 * choice made in one tool would be invisible to the next. The cookie is set on
 * the parent domain, so it follows the visitor across all of them (owner,
 * 2026-10-25).
 *
 * No React here, on purpose: a tool's static `terms.html` loads this module
 * through the tool's own `web/theme.js` entry, and that page has no business
 * fetching a renderer to set one attribute.
 */

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

/** One name for every tool, so a choice made in one is read by all. */
export const THEME_COOKIE = "webtools-theme";

/** A year: a preference is not worth asking for again every session. */
const MAX_AGE_SEC = 31_536_000;

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEME_CHOICES as readonly string[]).includes(value);
}

/** Where the cookie is written: the page's host and whether it is served over TLS. */
export interface CookieSite {
  hostname: string;
  protocol: string;
}

/** The slice of `Document` the cookie functions use, so a test can hand them a fake. */
export interface CookieJar {
  cookie: string;
}

/** The slice of `Storage` the one-time migration reads and clears. */
export interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/u;

/**
 * The `Domain=` the cookie carries, or `undefined` for a host-only cookie.
 *
 * The hostname minus its first label, when it has at least three and is not an
 * address: `downloader.oludoi.com` gives `oludoi.com`, which every sibling tool
 * is under. Anything shorter stays host-only, because a two-label name is
 * already the registrable domain (or `localhost`), and a browser refuses a
 * `Domain=` on an IP address outright. Cookies ignore the port, so the dev
 * servers on `localhost` share the host-only cookie anyway.
 */
export function cookieDomain(hostname: string): string | undefined {
  const host = hostname.replace(/\.$/u, "");
  // `location.hostname` gives an IPv6 address in brackets; a colon is enough.
  if (IPV4.test(host) || host.includes(":")) return undefined;
  const labels = host.split(".");
  if (labels.length < 3) return undefined;
  return labels.slice(1).join(".");
}

/**
 * The `document.cookie` assignment that records a choice. `system` is the
 * absence of a choice, so it deletes the cookie, with the same `Domain` and
 * `Path` it was written with: a deletion that differs in either deletes nothing.
 */
export function themeCookie(choice: ThemeChoice, site: CookieSite): string {
  const domain = cookieDomain(site.hostname);
  const parts = [
    choice === "system" ? `${THEME_COOKIE}=` : `${THEME_COOKIE}=${choice}`,
    "Path=/",
    `Max-Age=${String(choice === "system" ? 0 : MAX_AGE_SEC)}`,
    "SameSite=Lax",
  ];
  if (domain !== undefined) parts.push(`Domain=${domain}`);
  if (site.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

/** The choice a `document.cookie` string records, or `null` when it records none. */
export function readThemeCookie(cookies: string): Exclude<ThemeChoice, "system"> | null {
  for (const pair of cookies.split(";")) {
    const [name, value] = pair.trim().split("=");
    if (name === THEME_COOKIE && (value === "light" || value === "dark")) return value;
  }
  return null;
}

/** The current choice: the cookie's, or `system` when there is none. */
export function loadTheme(jar: CookieJar | undefined = globalThis.document): ThemeChoice {
  if (jar === undefined) return "system";
  try {
    return readThemeCookie(jar.cookie) ?? "system";
  } catch {
    // A sandboxed document throws on `cookie`; the OS's theme is a fine answer.
    return "system";
  }
}

export function saveTheme(
  choice: ThemeChoice,
  jar: CookieJar | undefined = globalThis.document,
  site: CookieSite | undefined = globalThis.location,
): void {
  if (jar === undefined || site === undefined) return;
  try {
    jar.cookie = themeCookie(choice, site);
  } catch {
    // Persisting a preference is not worth failing a render over.
  }
}

/**
 * Carries a choice a tool stored per origin before the cookie existed into the
 * cookie, once, and removes the old key. Only when there is no cookie yet: a
 * choice made since in another tool is the newer one and wins.
 *
 * The key is the caller's, because the old storage was the caller's: the
 * downloader's was `downloader:theme:v1`, and this package knows no tool's name.
 */
export function migrateStoredTheme(
  storage: StorageLike,
  key: string,
  jar: CookieJar | undefined = globalThis.document,
  site: CookieSite | undefined = globalThis.location,
): void {
  try {
    const stored = storage.getItem(key);
    if (stored === null) return;
    if (jar !== undefined && readThemeCookie(jar.cookie) === null && isThemeChoice(stored)) {
      saveTheme(stored, jar, site);
    }
    storage.removeItem(key);
  } catch {
    // Storage that throws (Safari private mode, a full quota) has nothing to migrate.
  }
}

/**
 * `system` removes the attribute entirely rather than resolving it, so the
 * stylesheet's `prefers-color-scheme` query stays in charge and follows a
 * mid-session OS change without a listener.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (choice === "system") {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "light dark";
  } else {
    root.setAttribute("data-theme", choice);
    root.style.colorScheme = choice;
  }
}

/**
 * Applies the stored choice to the document. A tool calls it at the top of
 * `main.tsx`, before `createRoot`, and its `web/theme.js` calls it for the
 * static terms page. Never from an inline script: the documents' policy is
 * `script-src 'self'` (dl-35).
 */
export function bootTheme(): void {
  applyTheme(loadTheme());
}
