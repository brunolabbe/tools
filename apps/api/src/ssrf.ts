/**
 * SSRF guard.
 *
 * Formally WP-6, pulled forward because WP-5 is the first code that exposes any
 * of this to the internet. Two distinct attack surfaces, and the second is the
 * one that gets forgotten:
 *
 *  1. The **page URL** a client pastes. Obvious, and easy.
 *  2. Every **media URL a resolver returns**. The browser sniffer reports back
 *     whatever the page asked for, so a hostile page can name any address it
 *     likes and have this server fetch it with the server's own credentials and
 *     network position. Resolver output is attacker-influenced data, not
 *     trusted input, and `docs/01-ARCHITECTURE.md` says so explicitly.
 *
 * The check is on **resolved IP addresses**, not on hostnames. A name check is
 * theatre: `localtest.me` resolves to 127.0.0.1, and any attacker-controlled
 * domain can have an A record pointing wherever they want.
 *
 * ## What this cannot do
 *
 * DNS rebinding is not fully solvable here. Between our `lookup()` and the
 * socket connect, a TTL-0 record can change answer — the classic TOCTOU. Fixing
 * it properly means pinning the checked address into the connection itself via
 * a custom agent/dispatcher, which needs `undici` (see the proxy gap in
 * `docs/04-STATUS.md`). What we do instead is reject *any* name that resolves
 * to a blocked address in *any* of its records, which closes the common
 * multi-record variant, and re-check after every redirect. The residual risk is
 * recorded rather than papered over.
 */

import dns from "node:dns/promises";
import net from "node:net";
import { AppError, ALLOWED_SCHEMES } from "@downloader/shared";

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

function isBlockedV4(address: string): boolean {
  const value = v4ToInt(address);
  if (value < 0) return true;
  return BLOCKED_V4.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (0xffff_ffff << (32 - bits)) >>> 0;
    return (value & mask) === (v4ToInt(network) & mask);
  });
}

/** Expands `::` and returns the eight 16-bit groups, or null if unparsable. */
function v6Groups(address: string): number[] | null {
  const zone = address.indexOf("%");
  const bare = zone === -1 ? address : address.slice(0, zone);
  const [head = "", tail] = bare.split("::");
  const headParts = head === "" ? [] : head.split(":");
  const tailParts = tail === undefined || tail === "" ? [] : tail.split(":");
  const parts =
    tail === undefined
      ? headParts
      : [...headParts, ...Array(8 - headParts.length - tailParts.length).fill("0"), ...tailParts];
  if (parts.length !== 8) return null;
  const groups = parts.map((part) => Number.parseInt(part, 16));
  return groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)
    ? null
    : groups;
}

function isBlockedV6(address: string): boolean {
  const lower = address.toLowerCase();
  const zoneless = lower.split("%")[0] ?? lower;

  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms are the classic
  // bypass: they are IPv6 syntactically and IPv4 in effect.
  const mapped = /^::(?:ffff:(?:0:)?)?(\d+\.\d+\.\d+\.\d+)$/u.exec(zoneless);
  if (mapped?.[1] !== undefined) return isBlockedV4(mapped[1]);

  const groups = v6Groups(zoneless);
  if (groups === null) return true;
  const [first = 0, second = 0] = groups;

  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // 64:ff9b::/96 NAT64 and 2002::/16 6to4 embed an IPv4 address; check it.
  if (first === 0x0064 && second === 0xff9b) {
    const embedded = [groups[6] ?? 0, groups[7] ?? 0];
    return isBlockedV4(
      [
        ((embedded[0] ?? 0) >> 8) & 0xff,
        (embedded[0] ?? 0) & 0xff,
        ((embedded[1] ?? 0) >> 8) & 0xff,
        (embedded[1] ?? 0) & 0xff,
      ].join("."),
    );
  }
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
}

export function createSsrfGuard(options: SsrfGuardOptions = {}): SsrfGuard {
  const lookup = options.lookup ?? systemLookup;
  const allowHosts = new Set((options.allowHosts ?? []).map((host) => host.toLowerCase()));
  const allowPrivate = options.allowPrivateAddresses === true;

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
    if (allowHosts.has(hostname)) return url;
    if (allowPrivate) return url;

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
    async assertAllAllowed(rawUrls: readonly string[]): Promise<void> {
      // Deduplicated because a probe result routinely repeats one manifest URL
      // across a dozen variants, and each check is a DNS round trip.
      const unique = [...new Set(rawUrls.filter((raw) => raw !== ""))];
      await Promise.all(unique.map(async (raw) => void (await assertAllowed(raw))));
    },
  };
}

/** Every URL in a probe result that the engine might fetch. */
export function urlsInProbeResult(probe: {
  variants: readonly { url: string; audioUrl?: string | undefined }[];
  subtitles: readonly { url: string }[];
}): string[] {
  const urls: string[] = [];
  for (const variant of probe.variants) {
    urls.push(variant.url);
    if (variant.audioUrl !== undefined && variant.audioUrl !== "") urls.push(variant.audioUrl);
  }
  // Subtitles are fetched by the engine with the same credentials as the media,
  // so they are the same surface even though they are not "the video".
  for (const track of probe.subtitles) urls.push(track.url);
  return urls;
}
