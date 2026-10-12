/**
 * The network address as a log line may hold it (dl-107).
 *
 * A request line used to carry `request.ip` whole: one household, for as long
 * as the container's log lives. What the log's readers need is whether a burst
 * came from one network, not which house, so the address is cut before it is
 * written: an IPv4 address to its /24, an IPv6 one to its /48. The rate limits
 * are unaffected, because they key on the whole address in memory
 * (`clientKey`, `@webtools/core/rate-limit`) and never read this.
 *
 * The IPv6 expansion is `clientKey`'s `v6Groups` copied rather than imported:
 * it is not exported, and a second consumer of a ten-line helper does not yet
 * pay for a change to core's public surface. If a third appears, lift it.
 */

import net from "node:net";

/** What a line says when the address cannot be read, so that nothing raw leaks. */
export const UNKNOWN_ADDRESS = "unknown";

function v6Groups(address: string): number[] | null {
  const [head = "", tail] = address.split("::");
  const headParts = head === "" ? [] : head.split(":");
  const tailParts = tail === undefined || tail === "" ? [] : tail.split(":");
  const missing = 8 - headParts.length - tailParts.length;
  if (tail !== undefined && missing < 1) return null;
  const parts =
    tail === undefined
      ? headParts
      : [...headParts, ...Array<string>(missing).fill("0"), ...tailParts];
  if (parts.length !== 8) return null;
  const groups = parts.map((part) => Number.parseInt(part, 16));
  return groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)
    ? null
    : groups;
}

/**
 * `203.0.113.77` becomes `203.0.113.0/24`; `2001:db8:1:2::9` becomes
 * `2001:db8:1::/48`; an IPv4-mapped IPv6 address is read as the IPv4 one it
 * wraps. A `/64` network, which is what `clientKey` returns for IPv6, is cut to
 * its /48 as well. Anything unreadable is `unknown`, never the raw string: a
 * value this cannot parse is not one to assume holds no address.
 */
export function shortenAddress(address: string | undefined): string {
  if (address === undefined || address === "") return UNKNOWN_ADDRESS;
  const bare = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const zoneless = (bare.split("%")[0] ?? bare).replace(/\/\d{1,3}$/u, "").toLowerCase();

  if (net.isIP(zoneless) === 4) return v4Network(zoneless);
  if (net.isIP(zoneless) !== 6) return UNKNOWN_ADDRESS;

  const mapped = /^::(?:ffff:(?:0:)?)?(\d+\.\d+\.\d+\.\d+)$/u.exec(zoneless);
  if (mapped?.[1] !== undefined && net.isIP(mapped[1]) === 4) return v4Network(mapped[1]);

  const groups = v6Groups(zoneless);
  if (groups === null) return UNKNOWN_ADDRESS;
  return `${groups
    .slice(0, 3)
    .map((group) => group.toString(16))
    .join(":")}::/48`;
}

function v4Network(address: string): string {
  return `${address.split(".").slice(0, 3).join(".")}.0/24`;
}

/**
 * A rate-limit bucket key as a log line may hold it. A key is `ip:<address>`, a
 * bare address, or `token:<hash>` (a capability route keyed on its credential's
 * digest, which holds no address and is left as it is).
 */
export function shortenKey(key: string): string {
  if (key.startsWith("token:")) return key;
  if (key.startsWith("ip:")) return `ip:${shortenAddress(key.slice("ip:".length))}`;
  return shortenAddress(key);
}
