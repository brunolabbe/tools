/**
 * The receipt reader (lg-8): one seam, one implementation, the model.
 *
 * **Claude Haiku 5.5 alone, no local OCR** — the owner's choice of 2026-10-12,
 * from fourteen real photos read by two local OCR engines and two models (the
 * table is on lg-8's Log). Haiku read the subtotal, GST, QST and total right on
 * all thirteen printed receipts; no engine was ever wrong in a way the
 * arithmetic check (`checkReceipt` in `books`) missed.
 *
 * **It reads, and does nothing else.** No reader classifies, computes a share or
 * files anything (`docs/00-ANALYSIS.md` §6, _What a reader is trusted with_): its
 * output is a list of proposals a person edits, a list because one measured
 * photo held two receipts side by side. The photo goes as it was sent: the
 * models read rotated photos without help, so nothing rotates it.
 *
 * **It reads no environment.** `api` reads the key and passes it in. The SDK
 * would otherwise read `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
 * `ANTHROPIC_BASE_URL` and `ANTHROPIC_LOG` for every option it is not given, so
 * each is passed explicitly, "nothing" included. The one it reads whatever it is
 * given is `ANTHROPIC_CUSTOM_HEADERS`, which can replace the key; `api` refuses
 * to boot with it set beside a key, as the planner's does. The planner's
 * provider is not reused: a tool never imports another tool.
 *
 * **Errors are mapped by class, never by message** (`failure`).
 */

import { Buffer } from "node:buffer";
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  InternalServerError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { AppError } from "@ledger/contract";
import type { ReceiptMediaType, ReceiptProposal } from "@ledger/contract";
import { z } from "zod";

/** A photo as it was uploaded: its bytes, and the type its first bytes say it is. */
export interface ReceiptPhoto {
  bytes: Uint8Array;
  mediaType: ReceiptMediaType;
}

/** The seam: a photo in, a proposal per receipt read in it out. */
export interface ReceiptReader {
  /** The model that reads, which the screen names before the photo is sent. */
  readonly model: string;
  read(photo: ReceiptPhoto, signal?: AbortSignal): Promise<ReceiptProposal[]>;
}

/** The measured model, and the default. */
export const DEFAULT_RECEIPT_MODEL = "claude-haiku-5-5";

/** Explicit, so the SDK never reads `ANTHROPIC_BASE_URL`. */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

/**
 * The prompt the measurement ran, less what lg-10 adds: the items, the deposits
 * and the handwritten amounts. A photo that is not a printed receipt gives no
 * proposal, and the person types it in.
 */
export const RECEIPT_PROMPT = `Read this photo of one or more Québec receipts. All money is in integer cents (12,49 $ -> 1249; a refund is negative).
For each printed receipt: the merchant, the date, the subtotal, GST (TPS), QST (TVQ) and total exactly as printed (null when the line is absent or unreadable).
If the photo is not a printed receipt, such as a handwritten note, return no receipts.`;

const cents = z.number().int().nullable();

/**
 * What the model is asked to answer with, as `output_config.format`. The API
 * takes only part of JSON Schema, so this is a promise of shape and not the
 * check: `toProposal` validates every value afterwards, and that is the check
 * that counts.
 */
const readingSchema = z.object({
  receipts: z.array(
    z.object({
      merchant: z.string().nullable(),
      date: z.string().nullable().describe("YYYY-MM-DD"),
      subtotal: cents,
      gst: cents.describe("TPS / GST"),
      qst: cents.describe("TVQ / QST"),
      total: cents,
    }),
  ),
});

type ReadReceipt = z.infer<typeof readingSchema>["receipts"][number];

/** A billion dollars: past it, a value is a misread, not an amount. */
const MAX_CENTS = 100_000_000_000;

function amount(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && Math.abs(value) <= MAX_CENTS
    ? value
    : null;
}

/** A day that exists, written `yyyy-mm-dd`, or `null`: the form then starts at the upload's date. */
function day(value: string | null): string | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const [year, month, date] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1));
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

function merchant(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed.slice(0, 200);
}

function toProposal(read: ReadReceipt): ReceiptProposal {
  return {
    merchant: merchant(read.merchant),
    date: day(read.date),
    subtotal: amount(read.subtotal),
    gst: amount(read.gst),
    qst: amount(read.qst),
    total: amount(read.total),
  };
}

/** The part of `api`'s logger this needs. The reader owns no logger. */
export interface ReaderLogger {
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface ModelReaderOptions {
  /** Anthropic is the one provider: the owner's choice, measured. */
  provider: "anthropic";
  /** Required, and never read from the environment here. */
  apiKey: string;
  model?: string | undefined;
  /** Per attempt. The SDK retries a timeout, so a read can take `(maxRetries + 1) ×` this. */
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  baseURL?: string | undefined;
  /** How requests leave the process. Tests answer from fixtures through this. */
  fetch?: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | undefined;
  logger?: ReaderLogger | undefined;
}

/**
 * Per attempt. Haiku's own seconds per receipt are unmeasured (lg-8 ran without
 * a key); a minute is far past what a phone's person waits for, and short of a
 * request nobody is waiting on any more.
 */
export const DEFAULT_READ_TIMEOUT_MS = 60_000;

/**
 * Room for adaptive thinking on top of a few hundred tokens of answer, as the
 * measurement's harness gave it. A reading cut short is refused, never guessed
 * from.
 */
const MAX_OUTPUT_TOKENS = 16_000;

export function createModelReader(options: ModelReaderOptions): ReceiptReader {
  if (options.apiKey.trim() === "") {
    // `api` builds no reader without a key; this is the library saying the same
    // to any other caller, rather than letting the SDK look in the environment.
    throw new AppError("RECEIPT_READER_UNCONFIGURED");
  }
  const model = options.model ?? DEFAULT_RECEIPT_MODEL;
  const logger = options.logger;
  const client = new Anthropic({
    apiKey: options.apiKey,
    authToken: null,
    webhookKey: null,
    baseURL: options.baseURL ?? ANTHROPIC_BASE_URL,
    timeout: options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? 2,
    // Its default logger is `console`, which this repo does not write to.
    logLevel: "off",
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  return {
    model,
    async read(photo, signal) {
      let message: Message;
      try {
        message = await client.messages.create(
          {
            model,
            max_tokens: MAX_OUTPUT_TOKENS,
            output_config: { effort: "medium", format: zodOutputFormat(readingSchema) },
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: photo.mediaType,
                      data: Buffer.from(photo.bytes).toString("base64"),
                    },
                  },
                  { type: "text", text: RECEIPT_PROMPT },
                ],
              },
            ],
          },
          signal === undefined ? {} : { signal },
        );
      } catch (error: unknown) {
        throw failure(error, logger);
      }
      return reading(message, logger);
    },
  };
}

/** The proposals in a reply, or `RECEIPT_UNREADABLE` when it holds no reading. */
function reading(message: Message, logger: ReaderLogger | undefined): ReceiptProposal[] {
  // `refusal` and `max_tokens` can leave text that does not match the schema,
  // or matches it with half a receipt; neither is read from.
  if (message.stop_reason !== "end_turn") {
    logger?.error("a receipt reading stopped short", { stopReason: message.stop_reason });
    throw new AppError("RECEIPT_UNREADABLE");
  }
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.join(""));
  } catch (cause: unknown) {
    throw new AppError("RECEIPT_UNREADABLE", undefined, { cause });
  }
  const checked = readingSchema.safeParse(parsed);
  if (!checked.success) {
    // The paths, never the values: a value is what is printed on someone's receipt.
    logger?.error("a receipt reading did not match its schema", {
      paths: checked.error.issues.map((issue) => issue.path.join(".")),
    });
    throw new AppError("RECEIPT_UNREADABLE");
  }
  return checked.data.receipts.map(toProposal);
}

/**
 * An SDK failure as this tool's error. The SDK has already retried a dropped
 * connection, a timeout, a 429 and a 5xx by the time one arrives here.
 *
 * - The caller hung up: `CANCELED`.
 * - No answer in time: `TIMEOUT`; no connection, or the service busy or failing:
 *   `UNREACHABLE`. All three are worth the person trying again.
 * - Anything else — a key refused, a request the API would not take — is this
 *   service's fault, not the person's: `INTERNAL`, with the status and the
 *   API's error type logged for the operator. Never its message, which can
 *   quote the request.
 */
function failure(error: unknown, logger: ReaderLogger | undefined): AppError {
  if (error instanceof APIUserAbortError)
    return new AppError("CANCELED", undefined, { cause: error });
  if (error instanceof APIConnectionTimeoutError) {
    return new AppError("TIMEOUT", "The receipt took too long to read. Try again.", {
      cause: error,
    });
  }
  if (error instanceof APIConnectionError) {
    return new AppError("UNREACHABLE", "The receipt reader could not be reached. Try again.", {
      cause: error,
    });
  }
  if (error instanceof RateLimitError || error instanceof InternalServerError) {
    return new AppError("UNREACHABLE", "The receipt reader is busy. Try again in a moment.", {
      cause: error,
      retryable: true,
    });
  }
  if (error instanceof APIError) {
    logger?.error("the receipt reader refused the request", {
      status: error.status,
      type: (error.error as { error?: { type?: unknown } } | undefined)?.error?.type,
    });
  }
  return new AppError("INTERNAL", undefined, { cause: error });
}
