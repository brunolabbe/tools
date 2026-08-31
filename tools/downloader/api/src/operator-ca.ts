/**
 * The operator's own trust anchor: read once, merged one way, handed to
 * everything that meets an origin.
 *
 * `EGRESS_CA_FILE` is the operator saying "and also this root". Three clients
 * of this process reach an origin and each has its own trust store, so "and
 * also this one" has to be said three times or it is not said at all:
 *
 * - the **egress proxy** that terminates ffmpeg's TLS (`tls-interception.ts`),
 * - the **undici dispatcher** every `GuardedFetch` goes through
 *   (`dispatcher.ts`) — added by dl-31, which is why this file exists,
 * - **ffmpeg itself**, when `FFMPEG_TLS_INTERCEPT` is off and it is meeting the
 *   origin again. That one takes a path rather than text, because `-ca_file`
 *   does, so it keeps reading `config.egressCaFile` in `server.ts`.
 *
 * Before dl-31 only the first heard it, and the deployment half worked with the
 * halves the confusing way round: an ffmpeg download succeeded while the probe
 * that set it up failed. The failure did not even look like trust — the
 * dispatcher's `DEPTH_ZERO_SELF_SIGNED_CERT` reaches `fetch` as a bare
 * `TypeError: fetch failed`, so the client is answered `502 UNREACHABLE`,
 * "The site could not be reached", `retryable: true`.
 */

import fs from "node:fs/promises";
import tls from "node:tls";
import { AppError } from "@downloader/contract";

/**
 * Merges rather than replaces, and that is the whole trap.
 *
 * Passing `ca` at all replaces Node's system store exactly as `-ca_file` does in
 * ffmpeg, so an operator root handed over on its own fails every *public*
 * origin. Every caller goes through here so there is one answer to that rather
 * than one per client.
 */
export function withSystemRoots(operatorCa: string): string[] {
  return [...tls.rootCertificates, operatorCa];
}

/**
 * Reads it at boot, and refuses to start if it cannot.
 *
 * dl-19 recorded that a typo'd path was discovered one download at a time, and
 * dl-27 made it fatal — but only on the path where the interception proxy
 * happened to read the file, so `FFMPEG_TLS_INTERCEPT=false` still discovered it
 * one download at a time. Reading it here, unconditionally, is what makes the
 * boot check cover both. Carrying on with the system store instead would refuse
 * the operator's own origins in a way that reads like their CDN is compromised.
 */
export async function readOperatorCa(caFile: string, variable: string): Promise<string> {
  try {
    return await fs.readFile(caFile, "utf8");
  } catch (cause) {
    throw new AppError("INTERNAL", `${variable} could not be read.`, {
      cause,
      details: { path: caFile },
    });
  }
}
