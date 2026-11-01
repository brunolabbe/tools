/**
 * Several receipt photos at once (lg-92): chosen together, kept one at a time,
 * read one at a time on a single tap, and confirmed one receipt at a time from
 * a list. The screen is `Receipts.tsx`; this file is the queue it holds.
 *
 * **Reads go one at a time, and a 429 waits.** A read is the paid call and is
 * limited per person (`rateLimitReceiptReadsPerMinute`, five a minute); a batch
 * larger than that meets the limit, and the limit is not raised to fit it. On
 * `RATE_LIMITED` the photo waits as long as `Retry-After` says (the client puts
 * the header into the error's `details`) and is read again, so no photo is
 * dropped. "n of N read" counts photos actually read, so it is not progress made
 * up: it rises when a read comes back and not before.
 *
 * **The queue is this screen's state.** Leaving it loses the readings that are
 * not filed; the photos themselves stay on the server, and bringing the unread
 * ones back here is not built.
 */

// oxlint-disable no-await-in-loop -- the photos go up and are read in turn, on purpose: a read is paid and rate-limited, and a batch must not fan out.

import { useEffect, useRef, useState } from "react";
import { formatCents } from "@ledger/books";
import { AppError, MAX_RECEIPT_PHOTO_BYTES } from "@ledger/contract";
import type { CheckedProposal, UploadedReceipt } from "@ledger/contract";
import { readReceipt, uploadReceipt } from "../api/receipts.ts";

/** Where a photo in the queue stands. */
type Phase = "uploading" | "kept" | "reading" | "waiting" | "failed" | "read";

export interface QueuedPhoto {
  key: number;
  name: string;
  phase: Phase;
  /** `null` while it is still going up. */
  receipt: UploadedReceipt | null;
  /** What the model read, once it has; one entry per receipt in the photo. */
  read: CheckedProposal[] | null;
  /** The parts of the photo that are filed. */
  filed: number[];
  /** Why the last read failed. */
  message: string | null;
  /** How long a rate-limited photo is waiting, in seconds. */
  waitSec: number | null;
}

/** A photo that did not join the queue, and why. */
interface Refused {
  name: string;
  reason: string;
}

/** The fewest and most seconds a wait is held to, whatever `Retry-After` says. */
const WAIT_MIN_SEC = 1;
const WAIT_MAX_SEC = 120;
/** Without a usable `Retry-After`, a quarter of the limit's minute. */
const WAIT_DEFAULT_SEC = 15;
/** In a row, for one photo: past this the read is reported as failed, with a retry. */
const MAX_WAITS = 5;

function waitSeconds(error: AppError): number {
  const sec = error.details?.["retryAfterSec"];
  if (typeof sec !== "number" || !Number.isFinite(sec)) return WAIT_DEFAULT_SEC;
  return Math.min(Math.max(Math.ceil(sec), WAIT_MIN_SEC), WAIT_MAX_SEC);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastPhotoKey = 0;

export interface ReceiptQueue {
  photos: readonly QueuedPhoto[];
  refused: readonly Refused[];
  /** A read, or a wait between two, is in progress. */
  reading: boolean;
  add: (files: readonly File[]) => void;
  readAll: () => void;
  retry: (key: number) => void;
  markFiled: (key: number, part: number) => void;
  clear: () => void;
}

export function useReceiptQueue(): ReceiptQueue {
  const [photos, setPhotos] = useState<QueuedPhoto[]>([]);
  const [refused, setRefused] = useState<Refused[]>([]);
  const [reading, setReading] = useState(false);
  // The queue as the async loops see it: state alone would hand each loop the
  // queue as it was when the loop began.
  const current = useRef<QueuedPhoto[]>([]);
  const readingNow = useRef(false);
  const uploads = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const commit = (next: QueuedPhoto[]): void => {
    current.current = next;
    setPhotos(next);
  };
  const patch = (key: number, change: Partial<QueuedPhoto>): void => {
    commit(current.current.map((photo) => (photo.key === key ? { ...photo, ...change } : photo)));
  };

  const uploadInTurn = async (
    earlier: Promise<void>,
    accepted: readonly { key: number; file: File }[],
  ): Promise<void> => {
    await earlier;
    for (const { key, file } of accepted) {
      if (!alive.current) return;
      try {
        const receipt = await uploadReceipt(file);
        patch(key, { receipt, phase: "kept" });
      } catch (error: unknown) {
        commit(current.current.filter((photo) => photo.key !== key));
        setRefused((before) => [
          ...before,
          { name: file.name, reason: AppError.from(error).message },
        ]);
      }
    }
  };

  const add = (files: readonly File[]): void => {
    const turnedAway: Refused[] = [];
    const accepted: { key: number; file: File }[] = [];
    for (const file of files) {
      if (file.size > MAX_RECEIPT_PHOTO_BYTES) {
        turnedAway.push({ name: file.name, reason: "over 7 MB. Take it again, closer." });
      } else {
        lastPhotoKey += 1;
        accepted.push({ key: lastPhotoKey, file });
      }
    }
    setRefused(turnedAway);
    commit([
      ...current.current,
      ...accepted.map(({ key, file }) => ({
        key,
        name: file.name,
        phase: "uploading" as const,
        receipt: null,
        read: null,
        filed: [],
        message: null,
        waitSec: null,
      })),
    ]);
    // One at a time, and after any earlier selection's.
    uploads.current = uploadInTurn(uploads.current, accepted);
  };

  const readPhoto = async (key: number): Promise<void> => {
    const receipt = current.current.find((photo) => photo.key === key)?.receipt;
    if (receipt === null || receipt === undefined) return;
    for (let waits = 0; ; waits += 1) {
      patch(key, { phase: "reading", message: null, waitSec: null });
      try {
        const answer = await readReceipt(receipt.id);
        patch(key, { phase: "read", read: answer.proposals });
        return;
      } catch (error: unknown) {
        const failure = AppError.from(error);
        if (failure.code !== "RATE_LIMITED" || waits >= MAX_WAITS) {
          patch(key, { phase: "failed", message: failure.message });
          return;
        }
        const seconds = waitSeconds(failure);
        patch(key, { phase: "waiting", waitSec: seconds });
        await sleep(seconds * 1_000);
        if (!alive.current) return;
      }
    }
  };

  /** Reads `keys()` one after another; a second call while one runs does nothing. */
  const readThese = async (keys: () => number[]): Promise<void> => {
    if (readingNow.current) return;
    readingNow.current = true;
    setReading(true);
    try {
      for (const key of keys()) {
        if (!alive.current) return;
        await readPhoto(key);
      }
    } finally {
      readingNow.current = false;
      if (alive.current) setReading(false);
    }
  };

  return {
    photos,
    refused,
    reading,
    add,
    readAll: () =>
      void readThese(() =>
        current.current.filter((photo) => photo.phase === "kept").map((photo) => photo.key),
      ),
    retry: (key) => void readThese(() => [key]),
    markFiled: (key, part) => {
      const photo = current.current.find((item) => item.key === key);
      if (photo !== undefined) patch(key, { filed: [...photo.filed, part] });
    },
    clear: () => {
      commit([]);
      setRefused([]);
    },
  };
}

/** A receipt as its button reads. */
function receiptLabel(checked: CheckedProposal): string {
  const { merchant, total } = checked.proposal;
  return `${merchant ?? "Unnamed"}${total === null ? "" : `, ${formatCents(total)}`}`;
}

export interface ReceiptQueueViewProps {
  id: string;
  queue: ReceiptQueue;
  /** What the last filing said. */
  said: string | null;
  problem: React.ReactElement | null;
  onOpen: (photo: QueuedPhoto, part: number, checked: CheckedProposal | null) => void;
  onChoose: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onStartOver: () => void;
}

export function ReceiptQueueView(props: ReceiptQueueViewProps): React.ReactElement {
  const { id, queue, said, problem, onOpen, onChoose, onStartOver } = props;
  const { photos, refused, reading } = queue;
  const unread = photos.filter((photo) => photo.phase === "kept");
  const uploading = photos.some((photo) => photo.phase === "uploading");
  const readCount = photos.filter((photo) => photo.phase === "read").length;
  // All photos of one server share one reader; the first kept one names it.
  const reader = photos.find((photo) => photo.receipt !== null)?.receipt?.reader ?? null;
  const settled = photos.length > 0 && !uploading;

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Receipts</h2>
      {said !== null && <output>{said}</output>}
      {refused.length > 0 && (
        <div className="bad" role="alert">
          <p>These photos were left out:</p>
          <ul aria-label="Photos left out">
            {refused.map((item, index) => (
              <li key={`${item.name}-${String(index)}`} className="name">
                {item.name}: {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(reading || readCount > 0) && (
        <output aria-label="Reading progress">
          {String(readCount)} of {String(photos.length)} read
        </output>
      )}
      <ul className="queue" aria-label="The photos">
        {photos.map((photo) => (
          <li key={photo.key}>
            <span className="name">{photo.name}</span>
            {photo.phase === "uploading" && <span className="muted hint">Keeping the photo…</span>}
            {photo.phase === "kept" && (
              <>
                <span className="muted hint">Kept, not read yet.</span>
                {!reading && (
                  <div className="actions">
                    <button type="button" onClick={() => onOpen(photo, 1, null)}>
                      Type it in
                    </button>
                  </div>
                )}
              </>
            )}
            {photo.phase === "reading" && <span className="muted hint">Reading…</span>}
            {photo.phase === "waiting" && (
              <span className="muted hint">
                Waiting {String(photo.waitSec)} s: reads are limited to a few a minute.
              </span>
            )}
            {photo.phase === "failed" && (
              <>
                <span className="bad hint">The read failed: {photo.message}</span>
                <div className="actions">
                  <button type="button" disabled={reading} onClick={() => queue.retry(photo.key)}>
                    Try again
                  </button>
                  <button type="button" disabled={reading} onClick={() => onOpen(photo, 1, null)}>
                    Type it in
                  </button>
                </div>
              </>
            )}
            {photo.phase === "read" && photo.read !== null && photo.read.length === 0 && (
              <>
                <span className="bad hint">
                  Nothing in the photo was read as a receipt. Type it in instead.
                </span>
                <div className="actions">
                  <button type="button" onClick={() => onOpen(photo, nextPart(photo.filed), null)}>
                    Type it in
                  </button>
                </div>
              </>
            )}
            {photo.phase === "read" && photo.read !== null && photo.read.length > 0 && (
              <ul className="parts" aria-label={`Receipts in ${photo.name}`}>
                {photo.read.map((checked, index) => {
                  const part = index + 1;
                  return (
                    <li key={part}>
                      {photo.filed.includes(part) ? (
                        <span className="muted">{receiptLabel(checked)}, filed</span>
                      ) : (
                        <button type="button" onClick={() => onOpen(photo, part, checked)}>
                          {receiptLabel(checked)}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {settled && unread.length > 0 && reader !== null && (
        <div className="offer">
          <p className="hint">
            Reading sends these photos out of the house, to Anthropic, where{" "}
            <strong>{reader}</strong> reads them, one at a time. Typing a receipt in sends nothing.
          </p>
          <div className="actions">
            <button type="button" disabled={reading} onClick={queue.readAll}>
              {reading ? "Reading…" : "Read all"}
            </button>
          </div>
        </div>
      )}
      {settled && reader === null && unread.length > 0 && (
        <p className="muted hint">Reading receipts is not set up here, so these are typed in.</p>
      )}
      {photos.length > 0 && (
        <p className="muted hint">
          This list lives on this screen: leave it and the readings you have not filed are lost. The
          photos stay on the household&rsquo;s server, but they do not come back here.
        </p>
      )}
      <label className="camera">
        Add more photos
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={reading}
          onChange={onChoose}
        />
      </label>
      <div className="actions">
        <button type="button" disabled={reading} onClick={onStartOver}>
          Start over
        </button>
      </div>
      {problem}
    </section>
  );
}

/** The first part of a photo not filed yet. */
export function nextPart(filed: readonly number[]): number {
  let part = 1;
  while (filed.includes(part)) part += 1;
  return part;
}
