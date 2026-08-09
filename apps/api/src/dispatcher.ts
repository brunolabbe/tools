/**
 * The egress dispatcher: what an outbound request may actually connect to.
 *
 * Two gaps in `docs/04-STATUS.md` close here, and they close together because
 * they are the same seam — undici is both the only way to pin a connection to a
 * vetted address and the only way to give Node's `fetch` a proxy.
 *
 * ## 1. DNS rebinding, properly this time
 *
 * `ssrf.ts` resolves a hostname and refuses it if any record is blocked. That
 * check is honest but not binding: the socket does its *own* resolution
 * afterwards, and a TTL-0 record is free to answer `93.184.216.34` the first
 * time and `169.254.169.254` the second. Classic TOCTOU, and no amount of
 * checking beforehand fixes it, because the thing being checked is not the
 * thing being connected to.
 *
 * The fix is to make them the same thing. `net.connect` accepts a `lookup`, and
 * undici passes one through from `Agent`'s `connect` options, so the resolution
 * the socket uses can be *ours*: resolve once, check every address, hand the
 * survivors straight to the socket. There is no second resolution to disagree
 * with the first, which is what makes it a fix rather than a narrower window.
 *
 * `ssrf.ts` stays where it is. It answers before a socket is opened, with a
 * typed error naming a reason, and it is the only check that can cover the URLs
 * ffmpeg fetches through its own HTTP stack. This file is what makes the answer
 * binding for everything that goes through `fetch`.
 *
 * ## 2. The proxy
 *
 * Node's global `fetch` ignores `http_proxy` entirely — so before this,
 * `PROXY_URL` reached ffmpeg and yt-dlp and the browser, and every direct fetch
 * quietly went around it. On a deployment that sets a proxy because its egress
 * IP matters, "quietly went around it" means signed URLs issued to one address
 * being redeemed from another, which sites answer with a 403 that reads like a
 * flaky extractor. `ProxyAgent` closes it.
 *
 * **The two modes are exclusive, and that is deliberate.** With a proxy the
 * target hostname is resolved by the proxy, not here, so there is no local
 * resolution to pin — address pinning is not weakened by the proxy, it is
 * simply not the mechanism in play. What guards a proxied deployment is the
 * proxy's own egress policy. The pre-flight check in `ssrf.ts` still runs, and
 * `SSRF_ALLOW_PRIVATE_ADDRESSES` exists for the deployment where this process's
 * DNS view differs from the proxy's.
 */

import dns from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { AppError } from "@downloader/shared";
import { Agent, ProxyAgent } from "undici";
import { isBlockedAddress } from "./ssrf.ts";
import type { SsrfGuard } from "./ssrf.ts";

/**
 * The dispatcher type global `fetch` accepts.
 *
 * `undici` ships its own declarations and `@types/node` ships a second copy as
 * `undici-types`; at these versions the two disagree about `onBodySent`, so an
 * `Agent` from the runtime package does not typecheck against the `RequestInit`
 * the runtime `fetch` is declared with — even though they are the same class at
 * run time. Taking the type from `RequestInit` means this alias is *by
 * definition* what `fetch` wants, and confines the resulting cast to the one
 * place the two declaration sets meet.
 */
export type FetchDispatcher = NonNullable<RequestInit["dispatcher"]>;

/** One answer from the resolver, in the shape `net.connect` wants back. */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/**
 * Resolves every address for a name. Injectable for the same reason
 * `SsrfGuardOptions.lookup` is: no test in this repo may touch a real resolver.
 */
export type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface EgressDispatcherOptions {
  guard: SsrfGuard;
  /** Operator-configured egress proxy. Switches this into proxy mode wholesale. */
  proxyUrl?: string | undefined;
  resolve?: AddressResolver;
}

export interface EgressDispatcher {
  dispatcher: FetchDispatcher;
  /**
   * Which mechanism is in force. Worth logging at boot: "why did this
   * deployment not pin addresses" is answered by this and nothing else.
   */
  mode: "pinned" | "proxy";
  close(): Promise<void>;
}

async function systemResolve(hostname: string): Promise<ResolvedAddress[]> {
  // `verbatim` keeps the resolver's own ordering rather than re-sorting v4
  // ahead of v6, so what we connect to is what DNS actually preferred.
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({ address: record.address, family: record.family }));
}

function blockedAddress(hostname: string, address: string): AppError {
  return new AppError("BLOCKED_TARGET", undefined, {
    // No URL here — the connector only ever sees a host. The pre-flight check
    // in `ssrf.ts` is the one that can name the path, and normally it fires
    // first; reaching this means the answer changed underneath it, which is
    // exactly the event worth being able to find in a log.
    details: { host: hostname, address, reason: "resolved-to-blocked-address-at-connect" },
  });
}

/**
 * The `lookup` the socket itself will use.
 *
 * Every record is checked, not merely the one that gets used, matching the rule
 * in `ssrf.ts`: a name answering with one public and one private address is the
 * multi-record rebinding trick, and connecting to whichever came first would
 * let it through some of the time.
 */
export function createPinningLookup(guard: SsrfGuard, resolve: AddressResolver): LookupFunction {
  return function pinningLookup(hostname, options, callback) {
    void (async (): Promise<void> => {
      let records: ResolvedAddress[];
      try {
        records = await resolve(hostname);
      } catch (cause) {
        callback(
          new AppError("UNREACHABLE", "That address could not be resolved.", {
            cause,
            details: { host: hostname },
          }),
          "",
          0,
        );
        return;
      }

      if (records.length === 0) {
        callback(blockedAddress(hostname, ""), "", 0);
        return;
      }

      if (!guard.isExemptHost(hostname)) {
        const offending = records.find((record) => isBlockedAddress(record.address));
        if (offending !== undefined) {
          callback(blockedAddress(hostname, offending.address), "", 0);
          return;
        }
      }

      // Filtering happens *after* the check on purpose: a v6 record we are not
      // going to use still tells us the name is hostile, and dropping it first
      // would hand back a clean v4 answer for a name that just pointed at
      // loopback over v6.
      const family = options.family === 4 || options.family === 6 ? options.family : 0;
      const usable = family === 0 ? records : records.filter((r) => r.family === family);
      if (usable.length === 0) {
        callback(
          new AppError("UNREACHABLE", "That address could not be resolved.", {
            details: { host: hostname, family },
          }),
          "",
          0,
        );
        return;
      }

      if (options.all === true) {
        callback(null, usable);
        return;
      }
      const first = usable[0] as ResolvedAddress;
      callback(null, first.address, first.family);
    })();
  };
}

export function createEgressDispatcher(options: EgressDispatcherOptions): EgressDispatcher {
  const proxyUrl = options.proxyUrl;

  if (proxyUrl !== undefined && proxyUrl !== "") {
    // No pinning connector here, and no SSRF check on the proxy's own address:
    // the proxy is named by the operator in an environment variable, not by
    // anything a client can influence, and a proxy on a private address is the
    // normal case rather than an attack.
    const agent = new ProxyAgent({ uri: proxyUrl });
    return {
      dispatcher: agent as unknown as FetchDispatcher,
      mode: "proxy",
      close: () => agent.close(),
    };
  }

  // No `maxRedirections`: undici does not follow redirects unless asked, and
  // it must stay that way — `guarded-fetch.ts` follows them by hand precisely
  // so each hop can be re-checked before it is taken.
  const agent = new Agent({
    connect: { lookup: createPinningLookup(options.guard, options.resolve ?? systemResolve) },
  });

  return {
    dispatcher: agent as unknown as FetchDispatcher,
    mode: "pinned",
    close: () => agent.close(),
  };
}
