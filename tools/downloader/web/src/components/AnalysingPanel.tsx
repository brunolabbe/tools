import { useElapsed } from "../hooks/useElapsed.ts";
import { ProgressBar } from "./ProgressBar.tsx";

/**
 * A browser probe reports no percentage — it loads a page, provokes playback
 * and waits for network quiet. So the bar is indeterminate and the reassurance
 * comes from elapsed time plus what the probe is actually doing at that point.
 * The stage list is narration keyed to the clock, not invented progress.
 */
const STAGES: readonly { afterMs: number; text: string }[] = [
  { afterMs: 0, text: "Opening a headless browser" },
  { afterMs: 1_500, text: "Loading the page and dismissing consent banners" },
  { afterMs: 4_000, text: "Provoking playback and watching network requests" },
  { afterMs: 9_000, text: "Waiting for the network to go quiet" },
  { afterMs: 16_000, text: "Still going — some sites are slow to start playing" },
];

interface AnalysingPanelProps {
  url: string;
  startedAt: number;
  onCancel: () => void;
}

export function AnalysingPanel({
  url,
  startedAt,
  onCancel,
}: AnalysingPanelProps): React.JSX.Element {
  const elapsed = useElapsed(startedAt);
  const seconds = Math.floor(elapsed / 1000);
  const activeIndex = STAGES.reduce(
    (current, stage, index) => (elapsed >= stage.afterMs ? index : current),
    0,
  );

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
      <ol className="stages" aria-live="polite">
        {STAGES.map((stage, index) => {
          const state = index === activeIndex ? "active" : index < activeIndex ? "done" : "pending";
          return (
            <li
              key={stage.afterMs}
              className={
                state === "pending" ? "stages__item" : `stages__item stages__item--${state}`
              }
              // Same gap, same fix as `JobCard`'s pipeline (dl-18): done, active
              // and pending were a colour and a `::before` tick, so the list
              // read as five undifferentiated items to anyone not looking at it.
              aria-current={state === "active" ? "step" : undefined}
              aria-label={state === "done" ? `${stage.text}, done` : undefined}
            >
              {stage.text}
            </li>
          );
        })}
      </ol>
      <p className="muted">Browser probes usually take 10–20 seconds.</p>
      <button type="button" className="button" onClick={onCancel}>
        Stop waiting
      </button>
    </section>
  );
}
