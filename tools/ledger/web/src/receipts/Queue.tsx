/**
 * Several receipt photos at once (lg-92): chosen together, kept one at a time,
 * read one at a time on a single tap, and filed from a list (lg-102). The
 * screen is `Receipts.tsx`; this file is the queue it holds. Every photo goes
 * through it, one or twelve, from the camera or the gallery: a photo on its own
 * was a second path that did the same thing differently.
 *
 * **Reads go one at a time, and a 429 waits.** A read is the paid call and is
 * limited per person (`rateLimitReceiptReadsPerMinute`, five a minute); a batch
 * larger than that meets the limit, and the limit is not raised to fit it. On
 * `RATE_LIMITED` the photo waits as long as `Retry-After` says (the client puts
 * the header into the error's `details`) and is read again, so no photo is
 * dropped. "n of N read" counts photos actually read, so it is not progress made
 * up: it rises when a read comes back and not before.
 *
 * **Each receipt is filed from its row** (lg-102). A row carries who paid and
 * whose the receipt is, a box to select it, and opens the receipt to correct
 * it; a bar sets only the pick the person changes on every selected row (each
 * keeps the other; the bar's selects start on, and return to, "Keep each row's")
 * and files them, one receipt at a time, each row saying filed or why not as its
 * answer comes back. A row's Remove takes a receipt out of the list, typed by
 * mistake or not a receipt, and hands a photo with nothing left back to the reader. A row
 * is held for exactly what its opened form holds (`receiptState`'s `refusal`),
 * and a joint-card receipt is attached only when exactly one row matches it.
 *
 * **The queue is this screen's state**, and so is each receipt's last-edited
 * draft and picks, keyed by photo and part (lg-102): going back to the list
 * keeps them, and leaving the screen loses every reading not filed. The photos
 * themselves stay on the server, and bringing the unread ones back here is not
 * built.
 */

// oxlint-disable no-await-in-loop -- the photos go up, are read and are filed in turn, on purpose: a read is paid and rate-limited, a batch must not fan out, and a filing's answer is shown as it comes.

import { useEffect, useId, useRef, useState } from "react";
import { AppError, MAX_RECEIPT_PHOTO_BYTES, MAX_RECEIPTS_PER_PHOTO } from "@ledger/contract";
import type { CheckedProposal, FileReceiptRequest, UploadedReceipt } from "@ledger/contract";
import { fetchReceiptMatches, fileReceipt, readReceipt, uploadReceipt } from "../api/receipts.ts";
import { shownName } from "../people.tsx";
import type { ShownNames } from "../people.tsx";
import {
  JOINT_CARD,
  SHARED,
  draftLabel,
  draftOf,
  filedAs,
  lineRequest,
  picksOf,
  receiptState,
  repick,
  settledPicks,
} from "./filing.ts";
import type { Draft, Picks } from "./filing.ts";
import { PhotoPickers } from "./PhotoPickers.tsx";

/** Where a photo in the queue stands. */
type Phase = "uploading" | "kept" | "reading" | "waiting" | "failed" | "read";

/** Where a receipt's filing from the list stands: going, refused and why, or filed as what. */
export type Outcome =
  | { state: "filing" }
  | { state: "refused"; message: string }
  | { state: "filed"; said: string };

/** One receipt in a photo, as last edited and picked (lg-102). */
export interface Entry {
  draft: Draft;
  picks: Picks;
  /** The category this merchant was last given, which the form offers first (lg-10). */
  merchantCategoryId: number | null;
  selected: boolean;
  outcome: Outcome | null;
}

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
  /** Each receipt read or typed in from it, by part. */
  entries: Readonly<Record<number, Entry>>;
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

/** The bar's first entry: no change to that pick. Not a name a member can have, and not "" (the joint card, Shared). */
const KEEP = "(keep each row's)";
const KEEP_ENTRY = "Keep each row's";

/** What a joint-card row says when the batch cannot pick its row alone (lg-102). */
export const CHOOSE_THE_ROW = "Open it to choose the row.";

function waitSeconds(error: AppError): number {
  const sec = error.details?.["retryAfterSec"];
  if (typeof sec !== "number" || !Number.isFinite(sec)) return WAIT_DEFAULT_SEC;
  return Math.min(Math.max(Math.ceil(sec), WAIT_MIN_SEC), WAIT_MAX_SEC);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastPhotoKey = 0;

export function entryOf(
  proposal: CheckedProposal["proposal"] | null,
  receipt: UploadedReceipt,
  merchantCategoryId: number | null,
): Entry {
  return {
    draft: draftOf(proposal, receipt, merchantCategoryId),
    picks: picksOf(receipt),
    merchantCategoryId,
    selected: false,
    outcome: null,
  };
}

export interface ReceiptQueue {
  photos: readonly QueuedPhoto[];
  refused: readonly Refused[];
  /** A read, or a wait between two, is in progress. */
  reading: boolean;
  /** The selected receipts are being filed. */
  filing: boolean;
  add: (files: readonly File[]) => void;
  /** Resolves with the queue as the reads left it. */
  readAll: () => Promise<readonly QueuedPhoto[]>;
  retry: (key: number) => void;
  /** Keeps a receipt typed in, as its part. */
  keep: (key: number, part: number, entry: Entry) => void;
  /** Changes a receipt's draft; a refusal it carried is answered by the change. */
  edit: (key: number, part: number, change: (draft: Draft) => Draft) => void;
  /** Sets a receipt's picks, its items following who paid (`repick`). */
  pick: (key: number, part: number, picks: Picks, people: readonly string[]) => void;
  /**
   * Changes the picks on every selected receipt not filed yet, by `change`: the
   * bar changes only the pick the person changed (the owner, 2026-11-07).
   */
  pickSelected: (change: (picks: Picks) => Picks, people: readonly string[]) => void;
  drop: (key: number, part: number) => void;
  /**
   * Takes a receipt not filed out of the list (the owner, 2026-11-07): one
   * typed in by mistake, or one the model made up. A photo left with none, and
   * none filed, is handed back to the reader, as it was before it was read.
   */
  remove: (key: number, part: number) => void;
  select: (key: number, part: number, selected: boolean) => void;
  selectAll: (selected: boolean) => void;
  markFiled: (key: number, part: number, said: string) => void;
  /** Files every selected receipt, one at a time; a second call while one runs does nothing. */
  fileSelected: (people: readonly string[], shown: ShownNames) => Promise<void>;
  clear: () => void;
}

/** Each part of the photo with a receipt in the list, in order. */
export function partsOf(photo: QueuedPhoto): number[] {
  return Object.keys(photo.entries)
    .map(Number)
    .toSorted((one, other) => one - other);
}

export function useReceiptQueue(): ReceiptQueue {
  const [photos, setPhotos] = useState<QueuedPhoto[]>([]);
  const [refused, setRefused] = useState<Refused[]>([]);
  const [reading, setReading] = useState(false);
  const [filing, setFiling] = useState(false);
  // The queue as the async loops see it: state alone would hand each loop the
  // queue as it was when the loop began.
  const current = useRef<QueuedPhoto[]>([]);
  const readingNow = useRef(false);
  const filingNow = useRef(false);
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
  const photoOf = (key: number): QueuedPhoto | undefined =>
    current.current.find((photo) => photo.key === key);
  /** One receipt's entry changed, or removed when `change` answers `null`. */
  const revise = (key: number, part: number, change: (entry: Entry) => Entry | null): void => {
    commit(
      current.current.map((photo) => {
        const entry = photo.entries[part];
        if (photo.key !== key || entry === undefined) return photo;
        const { [part]: _gone, ...rest } = photo.entries;
        const next = change(entry);
        return { ...photo, entries: next === null ? rest : { ...rest, [part]: next } };
      }),
    );
  };
  const reviseAll = (change: (photo: QueuedPhoto, part: number, entry: Entry) => Entry): void => {
    commit(
      current.current.map((photo) => ({
        ...photo,
        entries: Object.fromEntries(
          Object.entries(photo.entries).map(([part, entry]) => [
            part,
            change(photo, Number(part), entry),
          ]),
        ),
      })),
    );
  };
  const repicked = (entry: Entry, picks: Picks, people: readonly string[]): Entry => {
    const settled = settledPicks(picks);
    return {
      ...entry,
      picks: settled,
      draft: repick(entry.draft, entry.picks, settled, people),
      outcome: entry.outcome?.state === "refused" ? null : entry.outcome,
    };
  };
  const outcome = (key: number, part: number, next: Outcome | null): void => {
    revise(key, part, (entry) => ({ ...entry, outcome: next }));
  };
  const markFiled = (key: number, part: number, said: string): void => {
    const photo = photoOf(key);
    if (photo === undefined) return;
    patch(key, { filed: photo.filed.includes(part) ? photo.filed : [...photo.filed, part] });
    revise(key, part, (entry) => ({
      ...entry,
      selected: false,
      outcome: { state: "filed", said },
    }));
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
        entries: {},
        message: null,
        waitSec: null,
      })),
    ]);
    // One at a time, and after any earlier selection's.
    uploads.current = uploadInTurn(uploads.current, accepted);
  };

  const readPhoto = async (key: number): Promise<void> => {
    const receipt = photoOf(key)?.receipt;
    if (receipt === null || receipt === undefined) return;
    for (let waits = 0; ; waits += 1) {
      patch(key, { phase: "reading", message: null, waitSec: null });
      try {
        const answer = await readReceipt(receipt.id);
        const read = Object.fromEntries(
          answer.proposals.map((checked, index) => [
            index + 1,
            entryOf(checked.proposal, receipt, checked.merchantCategoryId),
          ]),
        );
        patch(key, {
          phase: "read",
          read: answer.proposals,
          entries: { ...read, ...photoOf(key)?.entries },
        });
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
  const readThese = async (keys: () => number[]): Promise<readonly QueuedPhoto[]> => {
    if (readingNow.current) return current.current;
    readingNow.current = true;
    setReading(true);
    try {
      for (const key of keys()) {
        if (!alive.current) return current.current;
        await readPhoto(key);
      }
      return current.current;
    } finally {
      readingNow.current = false;
      if (alive.current) setReading(false);
    }
  };

  /** One selected receipt filed, or refused on its row with why (lg-102). */
  const fileOne = async (
    key: number,
    part: number,
    people: readonly string[],
    shown: ShownNames,
  ): Promise<void> => {
    const photo = photoOf(key);
    const entry = photo?.entries[part];
    const receipt = photo?.receipt;
    if (entry === undefined || receipt === null || receipt === undefined) return;
    const state = receiptState(entry.draft, entry.picks, people);
    if (state.refusal !== null) {
      outcome(key, part, { state: "refused", message: state.refusal });
      return;
    }
    outcome(key, part, { state: "filing" });
    try {
      let request: FileReceiptRequest;
      if (entry.picks.joint) {
        const rows = await fetchReceiptMatches(receipt.id, state.charged ?? 0, entry.draft.date);
        const [only] = rows;
        if (rows.length !== 1 || only === undefined) {
          outcome(key, part, { state: "refused", message: CHOOSE_THE_ROW });
          return;
        }
        request = { part, proposal: state.proposal, destination: { to: "row", rowId: only.rowId } };
      } else {
        request = lineRequest(state, entry.draft, receipt, part);
      }
      const filed = await fileReceipt(receipt.id, request);
      markFiled(key, part, filedAs(filed, entry.picks.joint ? null : state.payer, shown));
    } catch (error: unknown) {
      outcome(key, part, { state: "refused", message: AppError.from(error).message });
    }
  };

  const fileSelected = async (people: readonly string[], shown: ShownNames): Promise<void> => {
    if (filingNow.current) return;
    filingNow.current = true;
    setFiling(true);
    try {
      const chosen = current.current.flatMap((photo) =>
        partsOf(photo)
          .filter((part) => photo.entries[part]?.selected === true && !photo.filed.includes(part))
          .map((part) => ({ key: photo.key, part })),
      );
      for (const { key, part } of chosen) {
        if (!alive.current) return;
        await fileOne(key, part, people, shown);
      }
    } finally {
      filingNow.current = false;
      if (alive.current) setFiling(false);
    }
  };

  return {
    photos,
    refused,
    reading,
    filing,
    add,
    readAll: () =>
      readThese(() =>
        current.current
          .filter((photo) => photo.phase === "kept" && !typedIn(photo))
          .map((photo) => photo.key),
      ),
    retry: (key) => void readThese(() => [key]),
    keep: (key, part, entry) => {
      const photo = photoOf(key);
      if (photo !== undefined) patch(key, { entries: { ...photo.entries, [part]: entry } });
    },
    edit: (key, part, change) =>
      revise(key, part, (entry) => ({
        ...entry,
        draft: change(entry.draft),
        outcome: entry.outcome?.state === "refused" ? null : entry.outcome,
      })),
    pick: (key, part, picks, people) =>
      revise(key, part, (entry) => repicked(entry, picks, people)),
    pickSelected: (change, people) =>
      reviseAll((photo, part, entry) =>
        entry.selected && !photo.filed.includes(part)
          ? repicked(entry, change(entry.picks), people)
          : entry,
      ),
    drop: (key, part) => revise(key, part, () => null),
    remove: (key, part) => {
      revise(key, part, () => null);
      const photo = photoOf(key);
      if (photo === undefined || photo.filed.length > 0 || partsOf(photo).length > 0) return;
      // Nothing left from its read: the photo is the reader's again, read or typed in anew.
      if (photo.phase === "read") patch(key, { phase: "kept", read: null });
    },
    select: (key, part, selected) => revise(key, part, (entry) => ({ ...entry, selected })),
    selectAll: (selected) =>
      reviseAll((photo, part, entry) =>
        photo.filed.includes(part) ? entry : { ...entry, selected },
      ),
    markFiled,
    fileSelected,
    clear: () => {
      commit([]);
      setRefused([]);
    },
  };
}

/**
 * A photo with a receipt typed in from it, never read: it is handled, so
 * **Read all** spends no read on it, and the count of photos to read leaves it out.
 */
function typedIn(photo: QueuedPhoto): boolean {
  return photo.read === null && (photo.filed.length > 0 || partsOf(photo).length > 0);
}

/** The first part of a photo that no receipt in the list holds, read or typed in. */
export function nextPart(photo: QueuedPhoto): number {
  let part = 1;
  while (
    photo.filed.includes(part) ||
    photo.entries[part] !== undefined ||
    part <= (photo.read?.length ?? 0)
  ) {
    part += 1;
  }
  return part;
}

/** A member's name as the Whose select offers them (lg-102). */
function owesAll(shown: ShownNames, person: string): string {
  return `${shownName(shown, person)}'s — owes all of it`;
}

export interface PickSelectsProps {
  picks: Picks;
  /** The household's current members (lg-30). */
  people: readonly string[];
  shown: ShownNames;
  /** The two selects' names; shown as labels when `labelled`, else only to assistive tech. */
  paidByLabel: string;
  whoseLabel: string;
  labelled: boolean;
  disabled: boolean;
  /**
   * The bar (lg-102): each select starts on, and returns to, "Keep each row's",
   * so it never shows a pick the rows do not all have; `picks` is then only the
   * base the person's one change is made on.
   */
  keep?: boolean;
  /** The picks as changed, and which of the two the person changed. */
  onChange: (picks: Picks, changed: "paid" | "whose") => void;
}

/**
 * Who paid, and whose the receipt is (lg-102): the list's row, its bar and the
 * opened receipt each carry the pair. Paid by offers each current member and
 * then the joint card; Whose offers Shared and then each member other than the
 * payer, who owes all of it, and is held on the joint card, where whose each
 * item is, is said item by item (lg-91).
 */
export function PickSelects(props: PickSelectsProps): React.ReactElement {
  const { picks, people, shown, paidByLabel, whoseLabel, labelled, disabled, onChange } = props;
  const keep = props.keep === true;
  const id = useId();
  const others = keep ? people : people.filter((person) => person !== picks.payer);
  // Whoever took the photo is offered even when the household's record lacks them.
  const payers = people.includes(picks.payer) ? people : [picks.payer, ...people];
  const naming = (field: string, label: string) =>
    labelled ? { id: `${id}-${field}` } : { "aria-label": label };
  return (
    <div className="picks">
      <span>
        {labelled && <label htmlFor={`${id}-paid`}>{paidByLabel}</label>}
        <select
          {...naming("paid", paidByLabel)}
          disabled={disabled}
          value={keep ? KEEP : picks.joint ? JOINT_CARD : picks.payer}
          onChange={(event) => {
            if (event.target.value === KEEP) return;
            onChange(
              event.target.value === JOINT_CARD
                ? { ...picks, joint: true }
                : { ...picks, joint: false, payer: event.target.value },
              "paid",
            );
          }}
        >
          {keep && <option value={KEEP}>{KEEP_ENTRY}</option>}
          {payers.map((person) => (
            <option key={person} value={person}>
              {shownName(shown, person)}
            </option>
          ))}
          <option value={JOINT_CARD}>Joint card</option>
        </select>
      </span>
      <span>
        {labelled && <label htmlFor={`${id}-whose`}>{whoseLabel}</label>}
        <select
          {...naming("whose", whoseLabel)}
          disabled={disabled || (picks.joint && !keep)}
          value={keep ? KEEP : picks.joint ? SHARED : (picks.whose ?? SHARED)}
          onChange={(event) => {
            if (event.target.value === KEEP) return;
            onChange(
              { ...picks, whose: event.target.value === SHARED ? null : event.target.value },
              "whose",
            );
          }}
        >
          {keep && <option value={KEEP}>{KEEP_ENTRY}</option>}
          <option value={SHARED}>Shared</option>
          {others.map((person) => (
            <option key={person} value={person}>
              {owesAll(shown, person)}
            </option>
          ))}
        </select>
      </span>
      {picks.joint && !keep && (
        <span className="muted hint">
          Paid with the joint card: whose each item is, is chosen item by item.
        </span>
      )}
    </div>
  );
}

export interface ReceiptQueueViewProps {
  id: string;
  queue: ReceiptQueue;
  /** The household's current members, or `null` until they load (lg-39). */
  people: readonly string[] | null;
  /** Says why the members are not there, with a retry, while `people` is `null`. */
  household: React.ReactElement | null;
  shown: ShownNames;
  problem: React.ReactElement | null;
  onOpen: (photo: QueuedPhoto, part: number) => void;
  onReadAll: () => void;
  onChoose: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onStartOver: () => void;
}

export function ReceiptQueueView(props: ReceiptQueueViewProps): React.ReactElement {
  const { id, queue, people, household, shown, problem } = props;
  const { onOpen, onReadAll, onChoose, onStartOver } = props;
  const { photos, refused, reading, filing } = queue;
  const unread = photos.filter((photo) => photo.phase === "kept" && !typedIn(photo));
  const uploading = photos.some((photo) => photo.phase === "uploading");
  const readCount = photos.filter((photo) => photo.phase === "read").length;
  const toRead = photos.filter((photo) => !typedIn(photo)).length;
  // All photos of one server share one reader; the first kept one names it.
  const reader = photos.find((photo) => photo.receipt !== null)?.receipt?.reader ?? null;
  const settled = photos.length > 0 && !uploading;
  // The words follow the count, so one photo reads as one photo.
  const one = unread.length === 1;
  const busy = reading || filing;
  const open = photos.flatMap((photo) =>
    partsOf(photo)
      .filter((part) => !photo.filed.includes(part))
      .map((part) => photo.entries[part]),
  );
  const chosen = open.filter((entry) => entry?.selected === true).length;
  // Whoever took the photos: one person's screen, so the first names them.
  const taker = photos.find((photo) => photo.receipt !== null)?.receipt?.uploadedBy ?? "";
  // The base for the bar's one change; the bar shows none of it (`keep`).
  const bar: Picks = { joint: false, payer: taker, whose: null };

  const row = (photo: QueuedPhoto, part: number): React.ReactElement | null => {
    const entry = photo.entries[part];
    if (entry === undefined) return null;
    const label = draftLabel(entry.draft);
    const filed = photo.filed.includes(part);
    const { outcome } = entry;
    // One status line per row, on the page before it says anything, so what it
    // says is announced (gate 1): an `<output>` is a polite live region.
    const status = (
      <output className={outcome?.state === "refused" ? "bad hint" : "muted hint"}>
        {outcome === null
          ? ""
          : outcome.state === "filing"
            ? "Filing…"
            : outcome.state === "refused"
              ? `Not filed: ${outcome.message}`
              : outcome.said}
      </output>
    );
    // One shape filed or not, the status line in the same place, so React keeps
    // that element and the region that said "Filing…" is the one that says filed.
    return (
      <li key={part}>
        {filed ? (
          <span className="muted">{label}, filed</span>
        ) : (
          <span className="opener">
            <input
              type="checkbox"
              aria-label={`Select ${label}`}
              checked={entry.selected}
              disabled={busy}
              onChange={(event) => queue.select(photo.key, part, event.target.checked)}
            />
            <button type="button" disabled={busy} onClick={() => onOpen(photo, part)}>
              {label}
            </button>
            <button
              type="button"
              className="remove"
              aria-label={`Remove ${label}`}
              title="Take it out of the list: typed by mistake, or not a receipt"
              disabled={busy}
              onClick={() => queue.remove(photo.key, part)}
            >
              Remove
            </button>
          </span>
        )}
        {!filed && people !== null && (
          <PickSelects
            picks={entry.picks}
            people={people}
            shown={shown}
            paidByLabel={`Paid by, ${label}`}
            whoseLabel={`Whose, ${label}`}
            labelled={false}
            disabled={busy}
            onChange={(picks) => queue.pick(photo.key, part, picks, people)}
          />
        )}
        {status}
      </li>
    );
  };

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{photos.length === 1 ? "Receipt" : "Receipts"}</h2>
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
          {String(readCount)} of {String(toRead)} read
        </output>
      )}
      {household}
      <ul className="queue" aria-label="The photos">
        {photos.map((photo) => {
          const parts = partsOf(photo);
          return (
            <li key={photo.key}>
              <span className="name">{photo.name}</span>
              {photo.phase === "uploading" && (
                <span className="muted hint">Keeping the photo…</span>
              )}
              {photo.phase === "kept" && !typedIn(photo) && (
                <>
                  <span className="muted hint">Kept, not read yet.</span>
                  {!busy && (
                    <div className="actions">
                      <button type="button" onClick={() => onOpen(photo, nextPart(photo))}>
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
              {photo.phase === "failed" && !typedIn(photo) && (
                <>
                  <span className="bad hint">The read failed: {photo.message}</span>
                  <div className="actions">
                    <button type="button" disabled={busy} onClick={() => queue.retry(photo.key)}>
                      Try again
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onOpen(photo, nextPart(photo))}
                    >
                      Type it in
                    </button>
                  </div>
                </>
              )}
              {photo.phase === "read" && photo.read !== null && parts.length === 0 && (
                <>
                  <span className="bad hint">
                    Nothing in the photo was read as a receipt. Type it in instead.
                  </span>
                  <div className="actions">
                    <button type="button" onClick={() => onOpen(photo, nextPart(photo))}>
                      Type it in
                    </button>
                  </div>
                </>
              )}
              {parts.length > 0 && (
                <ul className="parts" aria-label={`Receipts in ${photo.name}`}>
                  {parts.map((part) => row(photo, part))}
                </ul>
              )}
              {/* A receipt the read missed, or another typed in, once every one listed is filed. */}
              {parts.length > 0 &&
                parts.every((part) => photo.filed.includes(part)) &&
                nextPart(photo) <= MAX_RECEIPTS_PER_PHOTO &&
                !busy && (
                  <div className="actions">
                    <button type="button" onClick={() => onOpen(photo, nextPart(photo))}>
                      Type another receipt from this photo
                    </button>
                  </div>
                )}
            </li>
          );
        })}
      </ul>
      {people !== null && open.length > 0 && (
        <fieldset className="batch">
          <legend>The selected receipts</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={chosen === open.length}
              disabled={busy}
              onChange={(event) => queue.selectAll(event.target.checked)}
            />
            Select all
          </label>
          <p className="muted hint">
            Only the pick you change here is set on every selected receipt; each keeps the other.
          </p>
          <PickSelects
            picks={bar}
            people={people}
            shown={shown}
            paidByLabel="Paid by, for the selected"
            whoseLabel="Whose, for the selected"
            labelled={false}
            keep
            disabled={busy || chosen === 0}
            onChange={(picks, changed) => {
              // Only the pick the person changed; each row keeps the other (the owner, 2026-11-07).
              queue.pickSelected(
                (before) =>
                  changed === "paid"
                    ? {
                        ...before,
                        joint: picks.joint,
                        payer: picks.joint ? before.payer : picks.payer,
                      }
                    : { ...before, whose: picks.whose },
                people,
              );
            }}
          />
          <div className="actions">
            <button
              className="primary"
              type="button"
              disabled={busy || chosen === 0}
              onClick={() => void queue.fileSelected(people, shown)}
            >
              {filing ? "Filing…" : "File selected"}
            </button>
          </div>
        </fieldset>
      )}
      {settled && unread.length > 0 && reader !== null && (
        <div className="offer">
          <p className="hint">
            {one ? "Reading sends this photo" : "Reading sends these photos"} out of the house, to
            Anthropic, where <strong>{reader}</strong>{" "}
            {one ? "reads it." : "reads them, one at a time."} Typing a receipt in sends nothing.
          </p>
          <div className="actions">
            <button className="primary" type="button" disabled={busy} onClick={onReadAll}>
              {reading ? "Reading…" : one ? "Read it" : "Read all"}
            </button>
          </div>
        </div>
      )}
      {settled && reader === null && unread.length > 0 && (
        <p className="muted hint">
          Reading receipts is not set up here, so {one ? "this one is" : "these are"} typed in.
        </p>
      )}
      {photos.length > 0 && (
        <p className="muted hint">
          This list lives on this screen: leave it and the readings and changes you have not filed
          are lost. The photos stay on the household&rsquo;s server, but they do not come back here.
        </p>
      )}
      <PhotoPickers disabled={busy} onChoose={onChoose} />
      <div className="actions">
        {/* Not while photos go up: the uploads would finish into a queue that was cleared. */}
        <button type="button" disabled={busy || uploading} onClick={onStartOver}>
          Start over
        </button>
      </div>
      {problem}
    </section>
  );
}
