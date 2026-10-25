/**
 * The progress messages under a job's bar, one line each (dl-109): what the job
 * is doing, then anything that explains how. Drawn as the analysing panel draws
 * its stage line, so a page and the download it became read alike under the bar.
 *
 * A live region on the list, so a line added or replaced is announced.
 */

export interface ProgressMessage {
  key: string;
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
          {message.text}
        </li>
      ))}
    </ul>
  );
}
