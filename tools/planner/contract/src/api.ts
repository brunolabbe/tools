/**
 * HTTP API contract.
 *
 * The API app validates requests with these schemas; the web app derives its
 * client types from the same file. Neither side hand-writes a duplicate shape.
 *
 * Every schema is written `satisfies z.ZodType<T>` against the interface it
 * mirrors, so a field added to a type without a matching field here is a
 * compile error rather than a silent validation hole.
 */

import { z } from "zod";
import { ERROR_CODES } from "./errors.ts";
import type { AppErrorPayload } from "./errors.ts";
import { MESSAGE_ROLES } from "./conversation.ts";
import type { Conversation, ConversationDetail, Message } from "./conversation.ts";

/** One prefix, named once, so the UI and the dev proxy cannot disagree about it. */
export const API_PREFIX = "/api";

export const ROUTES = {
  health: `${API_PREFIX}/health`,
} as const;

/**
 * Ceiling on one user turn.
 *
 * Not a guess about how much someone might type: every character here is
 * re-sent to the model on every subsequent turn, so an unbounded field is an
 * unbounded bill as well as an unbounded request body.
 */
export const MAX_MESSAGE_CHARS = 8_000;

export const messageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  role: z.enum(MESSAGE_ROLES),
  content: z.string().max(MAX_MESSAGE_CHARS),
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<Message>;

export const conversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(200).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<Conversation>;

export const conversationDetailSchema = conversationSchema.extend({
  messages: z.array(messageSchema),
}) satisfies z.ZodType<ConversationDetail>;

export const errorPayloadSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<AppErrorPayload>;

/** What every failed request returns, whatever its status. */
export interface ErrorResponse {
  error: AppErrorPayload;
}
