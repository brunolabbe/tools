/**
 * The progress messages under a job's bar, one line each (dl-109): what the job
 * is doing, then anything that explains how. Each line leads with a small mark
 * in the same badge — an icon for a status line, or a short text such as
 * dl-108's "4×" connection count.
 *
 * A live region on the list, so a line added or replaced is announced; the marks
 * are decoration and hidden from assistive technology, the text carries it all.
 */

/** `search` marks the re-probe's latest stage (dl-110), under the status line's `refresh`. */
export type MessageIcon = "link" | "refresh" | "send" | "browser" | "search";

export interface ProgressMessage {
  key: string;
  /** An icon by name, or a few characters of text such as `"4×"`. */
  mark: MessageIcon | { text: string };
  text: string;
}

export function ProgressMessages({
  messages,
}: {
  messages: readonly ProgressMessage[];
}): React.JSX.Element {
  return (
    <ul className="job__messages" aria-live="polite">
      {messages.map((message) => (
        <li key={message.key} className="job__message">
          <span className="job__mark" aria-hidden="true">
            {typeof message.mark === "string" ? <Icon name={message.mark} /> : message.mark.text}
          </span>
          <span>{message.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Stroke icons drawn in `currentColor`, so the badge's colour is theirs in both themes. */
function Icon({ name }: { name: MessageIcon }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {name === "link" && (
        <>
          <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
          <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
        </>
      )}
      {name === "refresh" && (
        <>
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v5h-5" />
        </>
      )}
      {name === "send" && (
        <>
          <path d="M12 4v11" />
          <path d="M7 10l5 5 5-5" />
          <path d="M5 20h14" />
        </>
      )}
      {name === "browser" && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18" />
          <path d="M7 6.5h.01" />
          <path d="M10 6.5h.01" />
        </>
      )}
      {name === "search" && (
        <>
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.35-4.35" />
        </>
      )}
    </svg>
  );
}
