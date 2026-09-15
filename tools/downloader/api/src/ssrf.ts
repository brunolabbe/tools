/**
 * SSRF guard.
 *
 * Formally dl-6, pulled forward because dl-5 is the first code that exposes any
 * of this to the internet. Two distinct attack surfaces, and the second is the
 * one that gets forgotten:
 *
 *  1. The **page URL** a client pastes. Obvious, and easy.
 *  2. Every **media URL a resolver returns**. The browser sniffer reports back
 *     whatever the page asked for, so a hostile page can name any address it
 *     likes and have this server fetch it with the server's own credentials and
 *     network position. Resolver output is attacker-influenced data, not
 *     trusted input, and `tools/downloader/docs/01-ARCHITECTURE.md` says so explicitly.
 *
 * The check is on **resolved IP addresses**, not on hostnames. A name check is
 * theatre: `localtest.me` resolves to 127.0.0.1, and any attacker-controlled
 * domain can have an A record pointing wherever they want.
 *
 * ## What this file is, and is not
 *
 * This is the **pre-flight** check: it runs before a socket exists, so it can
 * refuse a URL cheaply and with a typed error that names a reason. What it
 * cannot do on its own is bind its answer to the connection — between this
 * `lookup()` and the socket connect, a TTL-0 record can change answer, which is
 * the classic DNS-rebinding TOCTOU.
 *
 * That gap is closed in `dispatcher.ts`, which resolves the name **once**,
 * inside the connector, and hands the vetted addresses straight to the socket.
 * The check that is load-bearing against rebinding is the one there; this one
 * remains because a rejection before any connection is attempted is worth
 * having, and because `assertAllAllowed` vets URLs that will be fetched by
 * ffmpeg, which no dispatcher of ours can reach.
 *
 * Both share one policy: `isBlockedAddress` for the address rule, and
 * `isExemptHost` below for the escape hatches, so the two cannot drift apart.
 */

import dns from "node:dns/promises";
import net from "node:net";
import { AppError, ALLOWED_SCHEMES } from "@downloader/contract";

/** Overridable so tests never touch a resolver, and so a proxy deployment can opt out. */
export interface SsrfGuardOptions {
  lookup?: (hostname: string) => Promise<string[]>;
  /**
   * Hostnames allowed through even when they resolve to a private address.
   * The local fixture server in the e2e suite is the intended use; a production
   * deployment leaves this empty.
   */
  allowHosts?: readonly string[];
  /**
   * Disables the address check wholesale. Exists because when every fetch is
   * routed through an egress proxy, this process resolves nothing itself and
   * the check would reject the proxy's own private address. Off by default, and
   * loudly named so it cannot be enabled by accident.
   */
  allowPrivateAddresses?: boolean;
}

async function systemLookup(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/**
 * IPv4 ranges that must never be reachable.
 *
 * `169.254.169.254` is not called out separately: it lives inside link-local,
 * which is blocked wholesale. Blocking the whole range rather than the single
 * famous address also covers GCP's `metadata.google.internal` and the
 * alternative metadata addresses other clouds expose.
 */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT — shared address space
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255
];

function v4ToInt(address: string): number {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return -1;
  // `>>> 0` keeps the result unsigned; the top octet would otherwise go negative.
  return (
    (((parts[0] ?? 0) << 24) |
      ((parts[1] ?? 0) << 16) |
      ((parts[2] ?? 0) << 8) |
      (parts[3] ?? 0)) >>>
    0
  );
}

function isBlockedV4Value(value: number): boolean {
  return BLOCKED_V4.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (0xffff_ffff << (32 - bits)) >>> 0;
    return (value & mask) === (v4ToInt(network) & mask);
  });
}

function isBlockedV4(address: string): boolean {
  const value = v4ToInt(address);
  return value < 0 || isBlockedV4Value(value);
}

const HEX_GROUP = /^[0-9a-f]{1,4}$/u;

/**
 * The eight 16-bit groups of an IPv6 address, or null if it does not parse.
 *
 * Every spelling of one address comes out as the same eight numbers — hex or
 * dotted tail, compressed or expanded, any case, with or without a zone id —
 * which is the point: dl-60 was a rule written against one spelling, while
 * `URL` hands the guard another.
 */
function v6Groups(address: string): number[] | null {
  const zone = address.indexOf("%");
  let bare = (zone === -1 ? address : address.slice(0, zone)).toLowerCase();

  // A dotted tail is the last 32 bits written as IPv4. Rewrite it as the two
  // hex groups it stands for, so the rest of this parses one grammar.
  const dotted = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(bare);
  if (dotted?.[1] !== undefined) {
    const value = v4ToInt(dotted[1]);
    if (value < 0) return null;
    const hex = `${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
    bare = bare.slice(0, bare.length - dotted[1].length) + hex;
  }

  const halves = bare.split("::");
  if (halves.length > 2) return null;
  const [head = "", tail] = halves;
  const headParts = head === "" ? [] : head.split(":");
  const tailParts = tail === undefined || tail === "" ? [] : tail.split(":");
  let parts: string[];
  if (tail === undefined) {
    parts = headParts;
  } else {
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 1) return null;
    parts = [...headParts, ...Array<string>(missing).fill("0"), ...tailParts];
  }
  if (parts.length !== 8 || parts.some((part) => !HEX_GROUP.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

/**
 * The IPv4 addresses an IPv6 address stands for, or null when it embeds none.
 *
 * Judged on the parsed value, never on a textual pattern. Each of these is IPv6
 * on the wire to this process and IPv4 somewhere on the path — in the kernel
 * itself for a mapped address on a dual-stack socket, which is the one measured
 * reachable (dl-60), or in a translator or relay for the rest.
 */
function embeddedV4(groups: readonly number[]): number[] | null {
  const g = (index: number): number => groups[index] ?? 0;
  const low32 = ((g(6) << 16) | g(7)) >>> 0;
  const zeroes = (from: number, to: number): boolean =>
    groups.slice(from, to).every((group) => group === 0);

  // ::ffff:0:0/96, IPv4-mapped.
  if (zeroes(0, 5) && g(5) === 0xffff) return [low32];
  // ::ffff:0:0:0/96, SIIT IPv4-translated (RFC 2765).
  if (zeroes(0, 4) && g(4) === 0xffff && g(5) === 0) return [low32];
  // ::/96, IPv4-compatible. Deprecated, and `::` and `::1` live here too; both
  // come out as 0.0.0.x, inside the blocked 0.0.0.0/8, so they stay refused.
  if (zeroes(0, 6)) return [low32];
  // 64:ff9b::/96 NAT64, and 64:ff9b:1::/48 local-use NAT64 read with the same
  // /96 layout — which is the rule this file applied before dl-60.
  if (g(0) === 0x0064 && g(1) === 0xff9b) return [low32];
  // 2002::/16, 6to4: the IPv4 address is the 32 bits after the prefix.
  if (g(0) === 0x2002) return [((g(1) << 16) | g(2)) >>> 0];
  // 2001::/32, Teredo: the server's address in the clear, and the client's —
  // the one a relay actually sends to — stored bit-inverted. Either refuses.
  if (g(0) === 0x2001 && g(1) === 0) return [((g(2) << 16) | g(3)) >>> 0, ~low32 >>> 0];
  return null;
}

function isBlockedV6(address: string): boolean {
  const groups = v6Groups(address);
  if (groups === null) return true;

  // Before the native rules, because these are not native addresses: an
  // IPv4-mapped loopback is loopback, whatever its first group says.
  const embedded = embeddedV4(groups);
  if (embedded !== null) return embedded.some((value) => isBlockedV4Value(value));

  const [first = 0] = groups;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True when this literal address must never be connected to. */
export function isBlockedAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return isBlockedV4(address);
  if (version === 6) return isBlockedV6(address);
  return true;
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function blocked(url: URL, reason: string, extra: Record<string, unknown> = {}): AppError {
  return new AppError("BLOCKED_TARGET", undefined, {
    // The host is safe to echo — the client supplied it — but the query string
    // may carry a signed credential, so only origin and path are recorded.
    details: { url: `${url.origin}${url.pathname}`, reason, ...extra },
  });
}

export interface SsrfGuard {
  /**
   * Throws `INVALID_URL` for a malformed or wrong-scheme address, and
   * `BLOCKED_TARGET` when it resolves somewhere we refuse to reach.
   */
  assertAllowed(rawUrl: string): Promise<URL>;
  /** Same, for every URL in a batch. Used on the whole of a `ProbeResult`. */
  assertAllAllowed(rawUrls: readonly string[]): Promise<void>;
  /**
   * Whether this hostname skips the address check entirely — because it is in
   * `allowHosts`, or because `allowPrivateAddresses` turned the check off.
   *
   * Exported so the connector in `dispatcher.ts` applies the *same* exemptions
   * this guard does. Duplicating the policy there instead would mean a local
   * fixture host that `assertAllowed` lets through gets refused at connect
   * time, which is a confusing failure and an easy one to introduce.
   */
  isExemptHost(hostname: string): boolean;
}

export function createSsrfGuard(options: SsrfGuardOptions = {}): SsrfGuard {
  const lookup = options.lookup ?? systemLookup;
  const allowHosts = new Set((options.allowHosts ?? []).map((host) => host.toLowerCase()));
  const allowPrivate = options.allowPrivateAddresses === true;

  function isExemptHost(hostname: string): boolean {
    return allowPrivate || allowHosts.has(stripBrackets(hostname.toLowerCase()));
  }

  async function assertAllowed(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new AppError("INVALID_URL", undefined, {
        details: { url: String(rawUrl).slice(0, 200) },
      });
    }

    if (!(ALLOWED_SCHEMES as readonly string[]).includes(url.protocol)) {
      // file:, data:, gopher: and friends. `gopher:` in particular is a classic
      // SSRF pivot into arbitrary TCP.
      throw new AppError(
        "INVALID_URL",
        "That address uses a scheme this service will not follow.",
        {
          details: { scheme: url.protocol },
        },
      );
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname === "") throw blocked(url, "empty-host");
    if (isExemptHost(hostname)) return url;

    // WHATWG `URL` *keeps* the brackets on an IPv6 literal, so `net.isIP` says
    // 0 for `[::1]` and the host would fall through to the DNS path. It would
    // fail closed there, but for the wrong reason and with the wrong error.
    const literal = stripBrackets(hostname);
    if (net.isIP(literal) !== 0) {
      if (isBlockedAddress(literal)) throw blocked(url, "blocked-address", { address: literal });
      return url;
    }

    let addresses: string[];
    try {
      addresses = await lookup(hostname);
    } catch (cause) {
      throw new AppError("UNREACHABLE", "That address could not be resolved.", {
        cause,
        details: { host: hostname },
      });
    }
    if (addresses.length === 0) throw blocked(url, "no-addresses");

    // *Every* record must be acceptable, not merely one. A name that answers
    // with both a public and a private address is the multi-record rebinding
    // trick, and picking the first answer would let it through half the time.
    const offending = addresses.find((address) => isBlockedAddress(address));
    if (offending !== undefined) {
      throw blocked(url, "resolves-to-blocked-address", { address: offending });
    }
    return url;
  }

  return {
    assertAllowed,
    isExemptHost,
    async assertAllAllowed(rawUrls: readonly string[]): Promise<void> {
      // Deduplicated because a probe result routinely repeats one manifest URL
      // across a dozen variants, and each check is a DNS round trip.
      const unique = [...new Set(rawUrls.filter((raw) => raw !== ""))];
      await Promise.all(unique.map(async (raw) => void (await assertAllowed(raw))));
    },
  };
}

/**
 * Every URL a probe result causes this service to fetch, split by what a
 * refusal costs.
 *
 * One function rather than two, so this file stays the single answer to "what
 * does a probe make us fetch" — the question that was answered wrongly until
 * dl-29, when the thumbnail was absent from here and unvetted, safe only for as
 * long as nothing fetched it.
 *
 * The split is about the consequence of a refusal, not about the check:
 *
 *  - `mustPass` is the media. A refusal there is the probe's whole answer, so
 *    both call sites hand this array straight to `assertAllAllowed`, which
 *    throws, exactly as they did before this field existed.
 *  - `bestEffort` is decorative — today, the preview image and nothing else. A
 *    preview on a blocked address must not cost a user a downloadable video, so
 *    its refusal is caught and the preview dropped. See `captureThumbnail`.
 *
 * One array could not express that: `assertAllAllowed` throws on any member, so
 * a blocked thumbnail would have failed the whole probe.
 */
export interface ProbeUrls {
  mustPass: string[];
  bestEffort: string[];
}

export function urlsInProbeResult(probe: {
  variants: readonly {
    url: string;
    alternateUrls?: readonly string[] | undefined;
    audioUrl?: string | undefined;
  }[];
  subtitles: readonly { url: string }[];
  thumbnailUrl?: string | undefined;
}): ProbeUrls {
  const mustPass: string[] = [];
  for (const variant of probe.variants) {
    mustPass.push(variant.url);
    // A failover mirror is fetched by the engine exactly as `url` is, and it
    // came out of the same attacker-influenced manifest (dl-45). Vetting only
    // the primary would leave a page free to name any address it liked as long
    // as it put a reachable one first.
    for (const alternate of variant.alternateUrls ?? []) {
      if (alternate !== "") mustPass.push(alternate);
    }
    if (variant.audioUrl !== undefined && variant.audioUrl !== "") mustPass.push(variant.audioUrl);
  }
  // Subtitles are fetched by the engine with the same credentials as the media,
  // so they are the same surface even though they are not "the video".
  for (const track of probe.subtitles) mustPass.push(track.url);

  const bestEffort =
    probe.thumbnailUrl === undefined || probe.thumbnailUrl === "" ? [] : [probe.thumbnailUrl];
  return { mustPass, bestEffort };
}
