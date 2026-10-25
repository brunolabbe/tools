/**
 * A workbook described by a model and imported on confirmation (lg-66). Both
 * requests carry the file, as base64: the server keeps nothing of it between
 * them.
 */

import { ROUTES } from "@ledger/contract";
import type {
  ConfirmWorkbookResponse,
  DescribeWorkbookResponse,
  WorkbookLayout,
} from "@ledger/contract";
import { requestJson } from "./client.ts";

/** The file's bytes as base64, a slice at a time so a large file does not overflow the stack. */
export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/** Sends the samples to the model: only ever on the person's press of the button. */
export async function describeWorkbook(file: string): Promise<DescribeWorkbookResponse> {
  return await requestJson<DescribeWorkbookResponse>(ROUTES.workbookDescribe, {
    method: "POST",
    body: { file, consent: true },
  });
}

/** The confirmation: the only call that imports anything. */
export async function confirmWorkbook(
  file: string,
  layout: WorkbookLayout,
): Promise<ConfirmWorkbookResponse> {
  return await requestJson<ConfirmWorkbookResponse>(ROUTES.workbookConfirm, {
    method: "POST",
    body: { file, layout },
  });
}
