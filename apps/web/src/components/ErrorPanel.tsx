import type { AppErrorPayload } from "@downloader/shared";
import { presentError } from "../lib/error-presentation.ts";

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
