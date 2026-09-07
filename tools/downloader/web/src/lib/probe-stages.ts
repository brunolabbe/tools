/**
 * The one line the analysing panel shows, from the stage the server last
 * reported (dl-43).
 *
 * The copy is here rather than in the panel because the mapping — not the
 * markup — is the thing worth testing on its own. Every entry names something
 * a resolver actually awaits; the vocabulary is closed by `PROBE_STAGES` in the
 * contract, so a stage with no line here is a compile error rather than a blank
 * panel.
 *
 * **Nothing in this file may be shown on a timer.** The panel renders whatever
 * the last frame said and nothing else; the five clock-keyed lines this
 * replaced were the defect the ticket was filed for.
 */

import type { ProbeStage, ProbeStageEvent } from "@downloader/contract";

/**
 * What the client can honestly say before the first frame arrives: the POST is
 * out and nothing has come back. It is not a stage — no resolver has reached
 * anything — which is why it does not live in `PROBE_STAGES`.
 */
export const PROBE_STAGE_PENDING = "Sent to the server — waiting for it to start";

const STAGE_TEXT: Record<Exclude<ProbeStage, "resolver-start">, string> = {
  "browser-slot": "Waiting for a free browser — they are all busy",
  "browser-launch": "Opening a headless browser",
  "page-load": "Loading the page",
  "provoke-playback": "Provoking playback and watching network requests",
  "network-quiet": "Waiting for the network to go quiet",
  "settle-requests": "Settling the last outstanding requests",
  "manifest-fetch": "Fetching the stream manifest",
  "manifest-parse": "Reading the stream manifest",
  "measure-variants": "Weighing the available qualities",
  "ytdlp-run": "Asking yt-dlp about this page",
  "direct-head": "Checking the address directly",
};

/**
 * How a tier is named to a user. Keyed on `Resolver.name`, which is a contract
 * value the server sends, so an unknown one falls back to something true rather
 * than to the raw identifier — a tier added server-side should not put its
 * internal name on screen in an older UI.
 */
const RESOLVER_TEXT: Record<string, string> = {
  direct: "Trying the address as a media link",
  "yt-dlp": "Trying yt-dlp",
  browser: "Trying a real browser",
};

const UNKNOWN_RESOLVER = "Trying another method";

export function probeStageText(event: ProbeStageEvent): string {
  if (event.stage === "resolver-start") {
    return RESOLVER_TEXT[event.resolver] ?? UNKNOWN_RESOLVER;
  }
  return STAGE_TEXT[event.stage];
}
