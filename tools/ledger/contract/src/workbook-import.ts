/**
 * Importing a workbook the reader does not know (lg-66): a model describes its
 * layout, the person reads what that description makes of the file, and
 * confirms. Two requests, and the server keeps nothing of the upload between
 * them, so each one carries the file.
 *
 * - **Describe** takes the file and the person's explicit agreement to send
 *   the samples, makes one model call, and answers with the description, what
 *   it reads, and the dry run's report. It writes nothing.
 * - **Confirm** takes the file and the description again, and imports only when
 *   every verification holds. It calls no model.
 *
 * A file of its own beside `api.ts`, as `layout.ts` is: one seam, its own.
 */

import { z } from "zod";
import type { Bucket } from "./api.ts";
import { workbookLayoutSchema } from "./layout.ts";
import type { WorkbookLayout } from "./layout.ts";

/**
 * The upload's bytes, before it is parsed: 4 MiB. A workbook of a household's
 * years is a few hundred kilobytes; the bound on what it inflates to, which is
 * the one that bounds the parse, is the server's (`MAX_WORKBOOK_INFLATED_BYTES`).
 */
export const MAX_WORKBOOK_BYTES = 4 * 1024 * 1024;

/**
 * What the model is shown of each sheet: its first rows, an even sample of the
 * middle, and its last rows (lg-38's view, `DEFAULT_VIEW` in `api`). Here so
 * the screen that says what leaves the house (Build 4.1) says what is sent.
 */
export const LAYOUT_SAMPLE_ROWS = { first: 12, middle: 6, last: 3 } as const;

/** The file as the requests carry it: its bytes, base64. */
const file = z.string().min(1);

export const describeWorkbookRequestSchema = z
  .object({
    file,
    /** The person pressed the button that says what is sent: nothing goes without it. */
    consent: z.literal(true),
  })
  .strict();
export type DescribeWorkbookRequest = z.infer<typeof describeWorkbookRequestSchema>;

export const confirmWorkbookRequestSchema = z
  .object({ file, layout: workbookLayoutSchema })
  .strict();
export type ConfirmWorkbookRequest = z.infer<typeof confirmWorkbookRequestSchema>;

/** A row the description reads, as the confirmation shows it. */
export interface WorkbookSampleRow {
  sheet: string;
  row: number;
  date: string;
  detail: string;
  amountCents: number;
}

/** The date column the description chose (Build 4.2), with the oldest and newest rows read. */
export interface DateColumnConfirmation {
  /** The column's letter. */
  column: string;
  /** The text above the first row read in that column, on its sheet; `null` when there is none. */
  header: string | null;
  /** The 3 oldest rows read, oldest first. */
  oldest: WorkbookSampleRow[];
  /** The 3 newest rows read, oldest first. */
  newest: WorkbookSampleRow[];
}

/** One label of the bucket column, the bucket it files a row in, and what it files. */
export interface BucketLabelConfirmation {
  label: string;
  bucket: Bucket;
  rows: number;
  /**
   * Up to 3 rows under it: the newest row of each of its 3 most frequent
   * details, most frequent first, then the newest rows not shown when it has
   * fewer than 3 details.
   */
  examples: WorkbookSampleRow[];
}

export interface WorkbookConfirmation {
  dateColumn: DateColumnConfirmation;
  /** Empty when the description names no bucket column. */
  buckets: BucketLabelConfirmation[];
}

export interface DescribeWorkbookResponse {
  layout: WorkbookLayout;
  /** Whether every verification holds, so the screen offers Confirm. */
  ok: boolean;
  /** Each verification that failed, in a sentence. */
  problems: string[];
  /** The dry run's report, as `import:ledger` prints it. */
  report: string;
  confirmation: WorkbookConfirmation;
  /** What the call cost, in the model's tokens. */
  usage: { inputTokens: number; outputTokens: number };
}

export interface ConfirmWorkbookResponse {
  /** The import's report, as `import:ledger --write` prints it. */
  report: string;
}
