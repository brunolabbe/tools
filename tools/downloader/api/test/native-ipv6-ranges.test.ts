/**
 * dl-63. Native IPv6 special-purpose ranges — addressed as IPv6 all the way,
 * with no IPv4 inside them, so dl-60's embedded-address rules never saw them.
 *
 * The owner chose option (c) on 2026-09-17: one flat list, `2001::/23` blocked
 * as a whole with no carve-outs. The cost of that choice is tested here rather
 * than assumed — the seven globally reachable sub-allocations inside
 * `2001::/23` are refused too, and a test says so.
 *
 * Each range is proven from both sides: its first, a middle and its last
 * address are blocked, and the address just past each edge is not. The edges
 * are what a wrong prefix length gets wrong, so they are the cases worth
 * having; a single address in the middle would pass a /8 as readily as a /64.
 */

import { AppError } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import { blockedLiteral } from "../src/dispatcher.ts";
import { createSsrfGuard, isBlockedAddress } from "../src/ssrf.ts";

/** Never consulted for a literal; throwing makes any accidental DNS use loud. */
const literalOnlyGuard = createSsrfGuard({
  lookup: async (hostname) => {
    if (hostname === "doc.example") return ["2001:db8::1"];
    if (hostname === "site.example") return ["2606:4700::1111"];
    throw new Error(`no DNS in this test: ${hostname}`);
  },
});

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "NO_ERROR";
  } catch (error) {
    return error instanceof AppError ? error.code : "NOT_APP_ERROR";
  }
}

interface RangeCase {
  range: string;
  /** First address, one from the middle, last address. */
  inside: readonly string[];
  /** Just past each edge — allowed, which is what proves the prefix length. */
  outside: readonly string[];
}

const RANGES: readonly RangeCase[] = [
  {
    range: "100::/64 (Discard-Only)",
    inside: ["100::", "100::1", "100::ffff:ffff:ffff:ffff"],
    // Above it sits the dummy prefix, itself blocked; the first allowed address
    // above both is 100:0:0:2::.
    outside: ["ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "100:0:0:2::"],
  },
  {
    range: "100:0:0:1::/64 (Dummy IPv6 Prefix, RFC 9780)",
    inside: ["100:0:0:1::", "100:0:0:1::1", "100:0:0:1:ffff:ffff:ffff:ffff"],
    outside: ["100:0:0:2::", "100:0:0:2::1"],
  },
  {
    range: "2001::/23 (IETF Protocol Assignments, whole)",
    inside: [
      "2001::",
      "2001:2::1", // Benchmarking, 2001:2::/48
      "2001:10::1", // deprecated ORCHID, 2001:10::/28
      "2001:100::1", // general space, no sub-allocation
      "2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff",
    ],
    outside: ["2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "2001:200::"],
  },
  {
    range: "2001:db8::/32 (Documentation)",
    inside: ["2001:db8::", "2001:db8:1234::1", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff"],
    outside: ["2001:db7:ffff:ffff:ffff:ffff:ffff:ffff", "2001:db9::"],
  },
  {
    range: "3fff::/20 (Documentation)",
    inside: ["3fff::", "3fff:800::1", "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff"],
    outside: ["3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "3fff:1000::"],
  },
  {
    range: "5f00::/16 (Segment Routing SIDs)",
    inside: ["5f00::", "5f00:1234::1", "5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
    outside: ["5eff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "5f01::"],
  },
  {
    range: "fec0::/10 (Site-Local, deprecated by RFC 3879)",
    inside: ["fec0::", "fec0::1", "feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
    // Both edges touch other blocked ranges — link-local below, multicast above.
    // The allowed address used is below unique-local; fe00::/9 is nearer, but it
    // is unblocked and undecided (dl-63 Log), so no test pins it either way.
    outside: ["fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
  },
];

/** The reachable allocations inside 2001::/23 that option (c) refuses anyway. */
const OVER_BLOCKED = [
  "2001:1::1", // PCP Anycast
  "2001:1::2", // TURN Anycast
  "2001:1::3", // DNS-SD Anycast
  "2001:3::1", // AMT, 2001:3::/32
  "2001:4:112::1", // AS112-v6, 2001:4:112::/48
  "2001:20::1", // ORCHIDv2, 2001:20::/28
  "2001:30::1", // Drone Remote ID Entity Tags, 2001:30::/28
] as const;

describe("native IPv6 special-purpose ranges (dl-63)", () => {
  test.each(RANGES)("$range is blocked, and the address past each edge is not", (row) => {
    for (const address of row.inside) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    for (const address of row.outside) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  test("every spelling of an address in a new range is judged the same", () => {
    for (const address of [
      "2001:DB8::1",
      "2001:0db8:0000:0000:0000:0000:0000:0001",
      "FEC0::1",
      "fec0::1%eth0",
      "3fff::192.0.2.1", // a dotted tail does not make it an embedded IPv4 address
      "0100:0000:0000:0001::",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  test("fe80:: to the top of the space is refused end to end, as is unique-local", () => {
    // Link-local, site-local and multicast meet with no gap. Unique-local does
    // not join them: fe00::/9 lies between it and link-local, and is not listed.
    for (const address of [
      "fc00::",
      "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "fe80::",
      "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "fec0::",
      "feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "ff00::",
      "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    expect(isBlockedAddress("fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(false);
  });

  test("the seven reachable allocations inside 2001::/23 are refused too — option (c)'s accepted cost", async () => {
    for (const address of OVER_BLOCKED) {
      expect(isBlockedAddress(address), address).toBe(true);
      expect(await codeOf(literalOnlyGuard.assertAllowed(`https://[${address}]/`)), address).toBe(
        "BLOCKED_TARGET",
      );
    }
  });

  test("public addresses near the new ranges stay allowed", async () => {
    for (const address of [
      "2001:4860:4860::8888", // Google Public DNS, outside 2001::/23
      "2606:4700::1111", // Cloudflare
      "2001:200::1", // the first /23 past the IETF block, an RIR allocation
    ]) {
      expect(isBlockedAddress(address), address).toBe(false);
      expect(await codeOf(literalOnlyGuard.assertAllowed(`https://[${address}]/`)), address).toBe(
        "NO_ERROR",
      );
    }
    expect(await codeOf(literalOnlyGuard.assertAllowed("https://site.example/"))).toBe("NO_ERROR");
  });

  test("the guard refuses each range as a URL literal, without consulting DNS", async () => {
    for (const row of RANGES) {
      const address = row.inside[1] ?? "";
      expect(await codeOf(literalOnlyGuard.assertAllowed(`https://[${address}]/`)), address).toBe(
        "BLOCKED_TARGET",
      );
    }
  });

  test("the connect-time literal check refuses each range too", () => {
    // `net.connect` skips `lookup` for a literal, so this is the check that
    // stands when the pre-flight one has been fooled (dl-60).
    for (const row of RANGES) {
      const address = row.inside[1] ?? "";
      expect(blockedLiteral(literalOnlyGuard, `[${address}]`)?.code, address).toBe(
        "BLOCKED_TARGET",
      );
    }
  });

  test("a name that resolves into a new range is refused", async () => {
    expect(await codeOf(literalOnlyGuard.assertAllowed("https://doc.example/video.mp4"))).toBe(
      "BLOCKED_TARGET",
    );
  });
});
