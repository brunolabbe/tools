// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://downloader.oludoi.com/"}

/**
 * The theme cookie (repo-131): which domain it lands on, that `system` deletes
 * it, and the downloader's one-time move out of `localStorage`.
 *
 * The page is `https://downloader.oludoi.com/`, the production shape, so the
 * cases that write through `document.cookie` go through jsdom's real cookie
 * jar: a `Domain=` the jar refused, or a deletion whose attributes did not
 * match the write, would leave `document.cookie` saying so. The other hosts are
 * read off the string `themeCookie` builds, because one test file has one URL.
 */

import { afterEach, describe, expect, test } from "vitest";
import {
  THEME_COOKIE,
  applyTheme,
  cookieDomain,
  loadTheme,
  migrateStoredTheme,
  readThemeCookie,
  saveTheme,
  themeCookie,
} from "../src/theme.ts";
import type { StorageLike } from "../src/theme.ts";

const LEGACY_KEY = "downloader:theme:v1";

/** Whatever the jar holds under the theme's name, read the way a browser reports it. */
function cookieValue(): string | undefined {
  return document.cookie
    .split("; ")
    .find((pair) => pair.startsWith(`${THEME_COOKIE}=`))
    ?.slice(THEME_COOKIE.length + 1);
}

afterEach(() => {
  saveTheme("system");
  localStorage.clear();
  applyTheme("system");
});

describe("the cookie's domain", () => {
  test("a tool's subdomain writes to the parent, so every sibling tool reads it", () => {
    expect(cookieDomain("downloader.oludoi.com")).toBe("oludoi.com");
    expect(themeCookie("dark", { hostname: "downloader.oludoi.com", protocol: "https:" })).toBe(
      "webtools-theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Domain=oludoi.com; Secure",
    );
  });

  test("localhost stays host-only, and plain http gets no Secure", () => {
    expect(cookieDomain("localhost")).toBeUndefined();
    expect(themeCookie("light", { hostname: "localhost", protocol: "http:" })).toBe(
      "webtools-theme=light; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });

  test("an IP address stays host-only: a browser refuses a Domain on one", () => {
    expect(cookieDomain("127.0.0.1")).toBeUndefined();
    expect(themeCookie("dark", { hostname: "127.0.0.1", protocol: "http:" })).not.toContain(
      "Domain=",
    );
    // Four labels, and still an address: the label count alone would have said `0.0.1`.
    expect(cookieDomain("10.0.0.1")).toBeUndefined();
    expect(cookieDomain("[::1]")).toBeUndefined();
  });

  test("a two-label name is already the registrable domain, and stays host-only", () => {
    expect(cookieDomain("oludoi.com")).toBeUndefined();
  });

  test("the jar on downloader.oludoi.com accepts the parent-domain cookie", () => {
    saveTheme("dark");

    expect(cookieValue()).toBe("dark");
    expect(loadTheme()).toBe("dark");
  });
});

describe("system is the absence of a choice", () => {
  test("choosing system deletes the cookie the earlier choice wrote", () => {
    saveTheme("dark");
    expect(cookieValue()).toBe("dark");

    saveTheme("system");

    // Gone, not set to "system": a deletion that missed the write's Domain or
    // Path would leave `dark` here.
    expect(cookieValue()).toBeUndefined();
    expect(loadTheme()).toBe("system");
    expect(themeCookie("system", { hostname: "downloader.oludoi.com", protocol: "https:" })).toBe(
      "webtools-theme=; Path=/; Max-Age=0; SameSite=Lax; Domain=oludoi.com; Secure",
    );
  });

  test("a cookie holding anything but light or dark reads as system", () => {
    expect(readThemeCookie("webtools-theme=purple")).toBeNull();
    expect(readThemeCookie("other=1; webtools-theme=light; more=2")).toBe("light");
    expect(readThemeCookie("")).toBeNull();
  });
});

describe("the downloader's one-time migration", () => {
  test("a stored choice and no cookie: the choice moves to the cookie and the key goes", () => {
    localStorage.setItem(LEGACY_KEY, "dark");

    migrateStoredTheme(localStorage, LEGACY_KEY);

    expect(cookieValue()).toBe("dark");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  test("a cookie already set wins over the older stored choice, and the key still goes", () => {
    saveTheme("light");
    localStorage.setItem(LEGACY_KEY, "dark");

    migrateStoredTheme(localStorage, LEGACY_KEY);

    expect(cookieValue()).toBe("light");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  test("it runs once: a second call has nothing to carry", () => {
    localStorage.setItem(LEGACY_KEY, "dark");
    migrateStoredTheme(localStorage, LEGACY_KEY);
    saveTheme("system");

    migrateStoredTheme(localStorage, LEGACY_KEY);

    // Had the key survived the first call, the second would write `dark` back.
    expect(cookieValue()).toBeUndefined();
  });

  test("a stored system, or a value that was never a choice, writes nothing and still goes", () => {
    for (const stored of ["system", "sepia"]) {
      localStorage.setItem(LEGACY_KEY, stored);
      migrateStoredTheme(localStorage, LEGACY_KEY);
      expect(cookieValue()).toBeUndefined();
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    }
  });

  test("storage that throws is not a failure", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => undefined,
    };
    expect(() => migrateStoredTheme(broken, LEGACY_KEY)).not.toThrow();
  });
});

describe("applyTheme", () => {
  test("light and dark set the attribute; system removes it so the media query decides", () => {
    const root = document.documentElement;

    applyTheme("dark");
    expect(root.dataset["theme"]).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");

    applyTheme("system");
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(root.style.colorScheme).toBe("light dark");
  });
});
