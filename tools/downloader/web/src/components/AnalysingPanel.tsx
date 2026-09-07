import type { ProbeStageEvent } from "@downloader/contract";
import { useElapsed } from "../hooks/useElapsed.ts";
import { PROBE_STAGE_PENDING, probeStageText } from "../lib/probe-stages.ts";
import { ProgressBar } from "./ProgressBar.tsx";

/**
 * What the server is doing right now, and only that (dl-43, option A).
 *
 * This used to be five lines keyed to `elapsed >= afterMs` on a client-side
 * timer, over a `POST /api/probe` that returns nothing until it is finished.
 * The names were right and the trigger was invented, so the panel narrated a
 * wait it could not observe — and three defects followed from the shape rather
 * than from the copy:
 *
 *  1. All five rendered at once, `.stages` being a wrapping flex row, so the
 *     line written to reassure at second 16 was on screen at second 0, where it
 *     reads as a warning.
 *  2. `aria-live="polite"` announced nothing, because advancing a stage changed
 *     only `className` and `aria-current`. A live region needs a *content*
 *     mutation.
 *  3. The indeterminate bar was a static gradient, so a stalled probe and a
 *     healthy one were pixel-identical.
 *
 * One line, replaced as the server reports a new stage, fixes 1 and 2 at once —
 * replacing the text *is* the content mutation the live region was waiting for.
 * 3 is in `styles.css`. There is deliberately **no gated bar here**: the
 * resolver tiers are a fallback chain in which exactly one succeeds, so a bar
 * that filled as the chain degraded would report failure as progress. The
 * download's pipeline is the opposite and gets one; see `JobCard`.
 *
 * The elapsed seconds are still a clock, and still honest — they measure how
 * long the user has waited, which is a fact, not a claim about the server.
 */
interface AnalysingPanelProps {
  url: string;
  startedAt: number;
  /** The last stage the server reported. `null` until the first frame lands. */
  stage: ProbeStageEvent | null;
  onCancel: () => void;
}

export function AnalysingPanel({
  url,
  startedAt,
  stage,
  onCancel,
}: AnalysingPanelProps): React.JSX.Element {
  const elapsed = useElapsed(startedAt);
  const seconds = Math.floor(elapsed / 1000);
  const line = stage === null ? PROBE_STAGE_PENDING : probeStageText(stage);

  return (
    <section className="card" aria-labelledby="analysing-heading">
      <div className="card__head">
        <h2 id="analysing-heading" className="card__title">
          Analysing
        </h2>
        <span className="pill">{seconds}s</span>
      </div>
      <p className="muted url-echo">{url}</p>
      <ProgressBar percent={null} label="Analysing page" />
      {/* `aria-live` on the element whose text changes, not on a wrapper whose
          children merely change class. `aria-atomic` because the whole line is
          replaced and half of it is never the news. */}
      <p className="stage" aria-live="polite" aria-atomic="true">
        {line}
      </p>
      <p className="muted">Browser probes usually take 10–20 seconds.</p>
      <button type="button" className="button" onClick={onCancel}>
        Stop waiting
      </button>
    </section>
  );
}
