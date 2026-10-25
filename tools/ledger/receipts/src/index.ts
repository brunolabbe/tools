/**
 * `@ledger/receipts` — the receipt reader (lg-8), and the only package in the
 * tool that talks to a model. lg-10 extended the same call to items and
 * categories, and lg-66 added the second call it makes: a workbook's layout,
 * described.
 */

export {
  ANTHROPIC_BASE_URL,
  DEFAULT_READ_TIMEOUT_MS,
  DEFAULT_RECEIPT_MODEL,
  RECEIPT_PROMPT,
  createModelReader,
} from "./reader.ts";
export type {
  CategoryChoice,
  ModelReaderOptions,
  ReaderLogger,
  ReceiptPhoto,
  ReceiptReader,
} from "./reader.ts";
export {
  LAYOUT_EFFORT,
  LAYOUT_MAX_OUTPUT_TOKENS,
  LAYOUT_MODEL,
  LAYOUT_TIMEOUT_MS,
  createLayoutAsk,
  layoutOutputFormat,
} from "./layout.ts";
export type { LayoutAnswer, LayoutAsk, LayoutAskOptions } from "./layout.ts";
