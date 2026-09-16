/**
 * dl-57 owner decision C: an IP-literal host is never stored as itself, and a
 * trailing FQDN dot does not make the same host group apart from itself.
 */

import { describe, expect, test } from "vitest";
import { hostnameOrNull, IP_LITERAL_HOST, normalizeHost } from "../src/host.ts";

describe("normalizeHost", () => {
  test("passes an ordinary hostname through unchanged", () => {
    expect(normalizeHost("site.example")).toBe("site.example");
  });

  test("masks an IPv4 literal", () => {
    expect(normalizeHost("93.184.215.14")).toBe(IP_LITERAL_HOST);
  });

  test("masks a bracketed IPv6 literal", () => {
    expect(normalizeHost("[2606:4700:4700::1111]")).toBe(IP_LITERAL_HOST);
  });

  test("removes exactly one trailing FQDN dot", () => {
    expect(normalizeHost("site.example.")).toBe("site.example");
  });

  test("a numeric or octal IPv4 form is already canonicalised before this runs", () => {
    // The WHATWG URL parser itself turns `1572395278` into dotted-decimal on
    // `.hostname` read — this function only ever sees the canonical form, and
    // still masks it.
    expect(normalizeHost("93.184.217.14")).toBe(IP_LITERAL_HOST);
  });
});

describe("hostnameOrNull", () => {
  test("extracts and normalises the hostname of a valid URL", () => {
    expect(hostnameOrNull("https://site.example/watch?sig=secret")).toBe("site.example");
  });

  test("masks an IP-literal URL", () => {
    expect(hostnameOrNull("http://127.0.0.1/admin")).toBe(IP_LITERAL_HOST);
  });

  test("is null for a string new URL() cannot parse", () => {
    expect(hostnameOrNull("not a url at all")).toBeNull();
  });
});
