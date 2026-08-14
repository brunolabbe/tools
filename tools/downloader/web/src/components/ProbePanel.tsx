import { useEffect, useId, useState } from "react";
import type { JobOptions, ProbeResult } from "@downloader/contract";
import { formatDuration } from "../lib/format.ts";
import { pickDefaultVariantId } from "../lib/variants.ts";
import { VariantTable } from "./VariantTable.tsx";

const CONTAINERS = ["mp4", "mkv", "webm", "source"] as const;

interface ProbePanelProps {
  probe: ProbeResult;
  cached: boolean;
  busy: boolean;
  onDownload: (options: JobOptions) => void;
  onReanalyse: () => void;
}

export function ProbePanel({
  probe,
  cached,
  busy,
  onDownload,
  onReanalyse,
}: ProbePanelProps): React.JSX.Element {
  const [variantId, setVariantId] = useState<string | null>(() =>
    pickDefaultVariantId(probe.variants),
  );
  const [container, setContainer] = useState<(typeof CONTAINERS)[number]>("mp4");
  const [audioOnly, setAudioOnly] = useState(false);
  const [embedSubtitles, setEmbedSubtitles] = useState(probe.subtitles.length > 0);
  const [liveDurationMin, setLiveDurationMin] = useState(5);

  const containerId = useId();
  const liveId = useId();

  useEffect(() => {
    setVariantId(pickDefaultVariantId(probe.variants));
  }, [probe]);

  const subtitleLanguages = [...new Set(probe.subtitles.map((track) => track.language))];

  function submit(): void {
    const options: JobOptions = {
      ...(variantId ? { variantId } : {}),
      container,
      audioOnly,
      embedSubtitles,
      ...(embedSubtitles && subtitleLanguages.length > 0 ? { subtitleLanguages } : {}),
      ...(probe.isLive ? { liveDurationSec: Math.round(liveDurationMin * 60) } : {}),
    };
    onDownload(options);
  }

  return (
    <section className="card" aria-labelledby="probe-heading">
      <div className="card__head">
        <h2 id="probe-heading" className="card__title">
          {probe.title}
        </h2>
        <div className="pills">
          {probe.isLive && <span className="pill pill--warn">Live</span>}
          {cached && <span className="pill">cached</span>}
          <span className="pill">{probe.resolver}</span>
        </div>
      </div>

      <p className="muted">
        {probe.durationSec ? `${formatDuration(probe.durationSec)} · ` : ""}
        {probe.variants.length} rendition{probe.variants.length === 1 ? "" : "s"}
        {probe.subtitles.length > 0 ? ` · ${probe.subtitles.length} subtitle tracks` : ""}
      </p>

      <VariantTable variants={probe.variants} selectedId={variantId} onSelect={setVariantId} />

      <fieldset className="options">
        <legend>Output</legend>

        <div className="options__row">
          <label htmlFor={containerId}>Container</label>
          <select
            id={containerId}
            value={container}
            onChange={(event) => {
              const next = event.target.value;
              const match = CONTAINERS.find((candidate) => candidate === next);
              if (match) setContainer(match);
            }}
          >
            {CONTAINERS.map((value) => (
              <option key={value} value={value}>
                {value === "source" ? "keep source" : value}
              </option>
            ))}
          </select>
        </div>

        <div className="options__row">
          <label>
            <input
              type="checkbox"
              checked={audioOnly}
              onChange={(event) => setAudioOnly(event.target.checked)}
            />
            Audio only
          </label>
        </div>

        <div className="options__row">
          <label>
            <input
              type="checkbox"
              checked={embedSubtitles}
              disabled={probe.subtitles.length === 0}
              onChange={(event) => setEmbedSubtitles(event.target.checked)}
            />
            Embed subtitles
            {subtitleLanguages.length > 0 ? ` (${subtitleLanguages.join(", ")})` : ""}
          </label>
        </div>

        {probe.isLive && (
          <div className="options__row">
            <label htmlFor={liveId}>Record for (minutes)</label>
            <input
              id={liveId}
              type="number"
              min={1}
              max={240}
              value={liveDurationMin}
              onChange={(event) => setLiveDurationMin(Number(event.target.value))}
            />
            <span className="muted">A live stream has no end, so it needs a limit.</span>
          </div>
        )}
      </fieldset>

      <div className="card__actions">
        <button type="button" className="button button--primary" onClick={submit} disabled={busy}>
          {busy ? "Starting…" : "Download"}
        </button>
        <button type="button" className="button" onClick={onReanalyse}>
          Analyse again
        </button>
      </div>
    </section>
  );
}
