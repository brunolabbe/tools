import { useId } from "react";

interface UrlFormProps {
  url: string;
  onUrlChange: (url: string) => void;
  onSubmit: () => void;
  busy: boolean;
  /** Inline validation message, or null when the field is acceptable. */
  invalid: string | null;
}

export function UrlForm({
  url,
  onUrlChange,
  onSubmit,
  busy,
  invalid,
}: UrlFormProps): React.JSX.Element {
  const inputId = useId();
  const errorId = useId();

  return (
    <form
      className="urlform"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="urlform__label" htmlFor={inputId}>
        Page address
      </label>
      <div className="urlform__row">
        <input
          id={inputId}
          className="urlform__input"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://example.com/watch/…"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          aria-invalid={invalid !== null}
          {...(invalid ? { "aria-describedby": errorId } : {})}
        />
        <button
          type="submit"
          className="button button--primary"
          disabled={busy || url.trim() === ""}
        >
          {busy ? "Analysing…" : "Analyse"}
        </button>
      </div>
      <p className="urlform__hint">
        Paste the page the video plays on, not the video file. The stream is found at the network
        layer, so players that use <code>blob:</code> URLs work too.
      </p>
      {invalid && (
        <p className="urlform__error" id={errorId} role="alert">
          {invalid}
        </p>
      )}
    </form>
  );
}
