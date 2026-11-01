/**
 * Where a receipt photo comes from: the camera or the gallery. Both the empty
 * receipt screen and the queue offer them, and every photo goes to the queue
 * (`Queue.tsx`) whichever it came from.
 */

const TAKE_PHOTO = "Take a photo of a receipt";
const CHOOSE_PHOTOS = "Choose photos of receipts";

/**
 * The two ways a photo joins the queue, as icons. The camera opens straight on
 * a phone (`capture`), and is the only way to it on recent Android, whose
 * gallery picker offers no camera. A desktop ignores `capture`, so there the
 * camera would be a second gallery button: the stylesheet shows it only to a
 * touch screen. The input is the label's own, hidden, so its name is the
 * label's text and a keyboard still reaches it.
 */
export function PhotoPickers(props: {
  disabled: boolean;
  onChoose: (event: React.ChangeEvent<HTMLInputElement>) => void;
}): React.ReactElement {
  const { disabled, onChoose } = props;
  const accept = "image/jpeg,image/png,image/webp";
  return (
    <div className="pickers">
      <label className="button pick pick-camera" title={TAKE_PHOTO}>
        <CameraIcon />
        <span className="sr-only">{TAKE_PHOTO}</span>
        <input
          className="sr-only"
          type="file"
          accept={accept}
          capture="environment"
          disabled={disabled}
          onChange={onChoose}
        />
      </label>
      <label className="button pick" title={CHOOSE_PHOTOS}>
        <PhotosIcon />
        <span className="sr-only">{CHOOSE_PHOTOS}</span>
        <input
          className="sr-only"
          type="file"
          accept={accept}
          multiple
          disabled={disabled}
          onChange={onChoose}
        />
      </label>
    </div>
  );
}

function CameraIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.8l1.5-2.2h6.4L16.7 7h2.8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.8" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

/** Two photos stacked, the back one peeking out: several, from the gallery. */
function PhotosIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M7 4.5h12A1.5 1.5 0 0 1 20.5 6v10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="3.5"
        y="7.5"
        width="14"
        height="12"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="m3.5 17 4-4 3 3 2-2 5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="13.5" cy="11" r="1.2" fill="currentColor" />
    </svg>
  );
}
