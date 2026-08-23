import type { AppErrorPayload } from "@downloader/contract";
import { presentError } from "../lib/error-presentation.ts";
import { formatRetryAfter } from "../lib/format.ts";

interface ErrorPanelProps {
  error: AppErrorPayload;
  /** Rendered only when the code allows it — see `error-presentation.ts`. */
  onRetry?: () => void;
  onDismiss?: () => void;
  retryLabel?: string;
}

export function ErrorPanel({
  error,
  onRetry,
  onDismiss,
  retryLabel = "Try again",
}: ErrorPanelProps): React.JSX.Element {
  const view = presentError(error);
  const showRetry = view.retryable && onRetry !== undefined;
  // Only ever a phrase the server supplied. When it said nothing, this is
  // `null` and no line is rendered — the alternative is guessing a wait, which
  // is the "never fake progress" rule wearing a different hat.
  const wait = formatRetryAfter(view.retryAfterSec);

  return (
    <div
      className={`notice notice--${view.tone}${view.final ? " notice--final" : ""}`}
      role={view.final ? "status" : "alert"}
    >
      <div className="notice__head">
        <h3 className="notice__title">{view.title}</h3>
        <code className="notice__code">{view.code}</code>
      </div>
      <p className="notice__message">{view.message}</p>
      <p className="notice__detail">{view.detail}</p>
      {wait && <p className="notice__wait">Wait {wait} before trying again.</p>}
      {(showRetry || onDismiss) && (
        <div className="notice__actions">
          {showRetry && (
            <button type="button" className="button button--primary" onClick={onRetry}>
              {retryLabel}
            </button>
          )}
          {onDismiss && (
            <button type="button" className="button" onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
