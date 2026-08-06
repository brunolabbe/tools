import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppError, sourceUrlSchema } from "@downloader/shared";
import type { AppErrorPayload, Job, JobOptions, ProbeResult } from "@downloader/shared";
import { USING_MOCK_API, api } from "./api/client.ts";
import { AnalysingPanel } from "./components/AnalysingPanel.tsx";
import { ErrorPanel } from "./components/ErrorPanel.tsx";
import { JobList } from "./components/JobList.tsx";
import { ProbePanel } from "./components/ProbePanel.tsx";
import { ScenarioHints } from "./components/ScenarioHints.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { UrlForm } from "./components/UrlForm.tsx";
import { useJobs } from "./hooks/useJobs.ts";
import { localErrorPayload } from "./lib/error-presentation.ts";
import { getBrowserStorage } from "./lib/job-store.ts";
import { applyTheme, loadTheme, saveTheme } from "./lib/theme.ts";
import type { ThemeChoice } from "./lib/theme.ts";

type Phase =
  | { kind: "idle" }
  | { kind: "analysing"; url: string; startedAt: number }
  | { kind: "probed"; url: string; probe: ProbeResult; cached: boolean };

export function App(): React.JSX.Element {
  const storage = useMemo(() => getBrowserStorage(), []);
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme(storage));
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [probeError, setProbeError] = useState<AppErrorPayload | null>(null);
  const [startError, setStartError] = useState<AppErrorPayload | null>(null);
  const [starting, setStarting] = useState(false);
  // Bumped on every new analysis so a late response from an abandoned probe
  // cannot overwrite the current one.
  const probeToken = useRef(0);

  const jobs = useJobs(api);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(storage, theme);
  }, [theme, storage]);

  const analyse = useCallback(async (candidate: string) => {
    const parsed = sourceUrlSchema.safeParse(candidate);
    if (!parsed.success) {
      setPhase({ kind: "idle" });
      setProbeError(localErrorPayload("INVALID_URL"));
      return;
    }
    const token = probeToken.current + 1;
    probeToken.current = token;
    setProbeError(null);
    setStartError(null);
    setPhase({ kind: "analysing", url: parsed.data, startedAt: Date.now() });

    try {
      const response = await api.probe({ url: parsed.data });
      if (probeToken.current !== token) return;
      setPhase({
        kind: "probed",
        url: parsed.data,
        probe: response.probe,
        cached: response.cached,
      });
    } catch (error) {
      if (probeToken.current !== token) return;
      setPhase({ kind: "idle" });
      setProbeError(AppError.from(error).toPayload());
    }
  }, []);

  const abandonProbe = useCallback(() => {
    probeToken.current += 1;
    setPhase({ kind: "idle" });
  }, []);

  const download = useCallback(
    async (options: JobOptions) => {
      if (phase.kind !== "probed") return;
      setStarting(true);
      setStartError(null);
      try {
        await jobs.start(phase.url, options);
      } catch (error) {
        setStartError(AppError.from(error).toPayload());
      } finally {
        setStarting(false);
      }
    },
    [jobs, phase],
  );

  const retryJob = useCallback(
    (job: Job) => {
      setUrl(job.sourceUrl);
      void analyse(job.sourceUrl);
    },
    [analyse],
  );

  const invalid =
    url.trim() !== "" && !sourceUrlSchema.safeParse(url).success
      ? "Enter a full http:// or https:// address."
      : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <h1>Downloader</h1>
          <p className="muted">Find the stream behind a page and pull it down as one file.</p>
        </div>
        <ThemeToggle value={theme} onChange={setTheme} />
      </header>

      <main className="layout">
        <section className="card" aria-labelledby="analyse-heading">
          <h2 id="analyse-heading" className="card__title">
            Analyse a page
          </h2>
          <UrlForm
            url={url}
            onUrlChange={setUrl}
            onSubmit={() => void analyse(url)}
            busy={phase.kind === "analysing"}
            invalid={invalid}
          />
        </section>

        {probeError && (
          <ErrorPanel
            error={probeError}
            onRetry={() => void analyse(url)}
            onDismiss={() => setProbeError(null)}
            retryLabel="Analyse again"
          />
        )}

        {phase.kind === "analysing" && (
          <AnalysingPanel url={phase.url} startedAt={phase.startedAt} onCancel={abandonProbe} />
        )}

        {phase.kind === "probed" && (
          <>
            <ProbePanel
              probe={phase.probe}
              cached={phase.cached}
              busy={starting}
              onDownload={(options) => void download(options)}
              onReanalyse={() => void analyse(phase.url)}
            />
            {startError && <ErrorPanel error={startError} onDismiss={() => setStartError(null)} />}
          </>
        )}

        <JobList
          jobs={jobs.jobs}
          streamStates={jobs.streamStates}
          onCancel={(id) => void jobs.cancel(id)}
          onRemove={jobs.remove}
          onRetry={retryJob}
          onClearFinished={jobs.clearFinished}
        />

        {USING_MOCK_API && (
          <ScenarioHints
            onPick={(picked) => {
              setUrl(picked);
              void analyse(picked);
            }}
          />
        )}
      </main>
    </div>
  );
}
