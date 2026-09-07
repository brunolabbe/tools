/**
 * Names for a probe's stage channel (dl-43).
 *
 * Minted here rather than by the server because the POST that starts a probe is
 * also the request that would have to hand one back, and by then the first
 * stages have already happened. `probeIdSchema` in the contract carries the
 * rest of that reasoning and the shape this must satisfy.
 *
 * `crypto.getRandomValues`, not `crypto.randomUUID`: the second is restricted
 * to secure contexts, and this app is routinely opened over plain http at a LAN
 * address during development and on a self-hosted box. An id that failed to
 * mint there would take the narration with it for exactly the audience most
 * likely to be watching a slow probe.
 */

const BYTES = 16;

export function mintProbeId(): string {
  const bytes = new Uint8Array(BYTES);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
