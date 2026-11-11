import { useCallback, useState } from "react";
import { sourceUrlSchema } from "@downloader/contract";
import { AppFooter, AppHeader, TOOL_VERSION } from "@webtools/ui";
import type { AppErrorPayload } from "@downloader/contract";
import { USING_MOCK_API, api } from "./api/client.ts";
import { BoxList } from "./components/BoxList.tsx";
import { ErrorPanel } from "./components/ErrorPanel.tsx";
import { Glyph } from "./components/Glyph.tsx";
import { ScenarioHints } from "./components/ScenarioHints.tsx";
import { UrlForm } from "./components/UrlForm.tsx";
import { useBoxes } from "./hooks/useBoxes.ts";
import { useJobs } from "./hooks/useJobs.ts";
import { localErrorPayload } from "./lib/error-presentation.ts";

export function App(): React.JSX.Element {
  // Kept after Analyse (dl-133 decision 3): the clear button empties it.
  const [url, setUrl] = useState("");
  // An address the contract refuses makes no box: nothing was analysed, so the
  // answer belongs to the form that was submitted.
  const [formError, setFormError] = useState<AppErrorPayload | null>(null);

  const jobs = useJobs(api);
  const boxes = useBoxes(api, jobs);
  const { analyse: open } = boxes;

  const analyse = useCallback(
    (candidate: string) => {
      const parsed = sourceUrlSchema.safeParse(candidate);
      if (!parsed.success) {
        setFormError(localErrorPayload("INVALID_URL"));
        return;
      }
      setFormError(null);
      open(parsed.data);
    },
    [open],
  );

  const invalid =
    url.trim() !== "" && !sourceUrlSchema.safeParse(url).success
      ? "Enter a full http:// or https:// address."
      : null;

  return (
    <div className="app">
      <AppHeader
        name="Downloader"
        tagline="Find the stream behind a page and pull it down as one file."
        glyph={<Glyph />}
      />

      <main className="layout">
        <section className="card" aria-labelledby="analyse-heading">
          <h2 id="analyse-heading" className="card__title">
            Analyse a page
          </h2>
          {/* Never busy: each Analyse makes its own box, and a third waits in
              its box for a slot rather than here (dl-133). */}
          <UrlForm url={url} onUrlChange={setUrl} onSubmit={() => analyse(url)} invalid={invalid} />
        </section>

        {formError && <ErrorPanel error={formError} onDismiss={() => setFormError(null)} />}

        {/* Directly under the field, newest first (dl-133 decision 4): a new box
            lands where the eye already is, however many are below it. */}
        <BoxList
          boxes={boxes.boxes}
          jobs={jobs.jobs}
          titles={jobs.titles}
          streamStates={jobs.streamStates}
          refusals={jobs.refusals}
          stages={jobs.stages}
          revealId={boxes.revealId}
          onClose={boxes.close}
          onReanalyse={boxes.reanalyse}
          onDownload={boxes.download}
          onClearStartError={boxes.clearStartError}
          onStopWaitingDownload={boxes.stopWaitingDownload}
          onFollowLink={jobs.clearRefusal}
          onCancel={(id) => void jobs.cancel(id)}
          onDismissJob={boxes.dismissJob}
          onRetryJob={boxes.retryJob}
        />

        {USING_MOCK_API && (
          <ScenarioHints
            onPick={(picked) => {
              setUrl(picked);
              analyse(picked);
            }}
          />
        )}
      </main>

      {/* A plain link, not a route: the page is a static file beside the bundle
          (`public/terms.html`), served same-origin, so the document policy needs
          no change for it (dl-54). */}
      <AppFooter version={TOOL_VERSION} termsHref="/terms.html" />
    </div>
  );
}
