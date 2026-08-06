/**
 * HTTP API contract.
 *
 * The API app validates requests with these schemas; the web app derives its
 * client types from the same file. Neither side hand-writes a duplicate shape.
 */

import { z } from "zod";
import type { AppErrorPayload } from "./errors.ts";
import type { Job, JobOptions } from "./job.ts";
import type { ProbeResult } from "./media.ts";

/** Schemes we will follow. Anything else is rejected as `INVALID_URL`. */
export const ALLOWED_SCHEMES = ["http:", "https:"] as const;

export const sourceUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      return (ALLOWED_SCHEMES as readonly string[]).includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Must be an http(s) URL");

export const jobOptionsSchema = z.object({
  variantId: z.string().min(1).max(200).optional(),
  container: z.enum(["mp4", "mkv", "webm", "source"]).optional(),
  embedSubtitles: z.boolean().optional(),
  subtitleLanguages: z.array(z.string().min(2).max(20)).max(10).optional(),
  audioOnly: z.boolean().optional(),
  liveDurationSec: z
    .number()
    .int()
    .positive()
    .max(4 * 60 * 60)
    .optional(),
}) satisfies z.ZodType<JobOptions>;

export const probeRequestSchema = z.object({
  url: sourceUrlSchema,
  /** Skip the probe cache and re-analyse. */
  refresh: z.boolean().optional(),
});

export const createJobRequestSchema = z.object({
  url: sourceUrlSchema,
  options: jobOptionsSchema.optional(),
});

export type ProbeRequest = z.infer<typeof probeRequestSchema>;
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

export interface ProbeResponse {
  probe: ProbeResult;
  /** True when served from cache rather than freshly analysed. */
  cached: boolean;
}

export interface JobResponse {
  job: Job;
}

export interface JobListResponse {
  jobs: Job[];
  total: number;
}

export interface ErrorResponse {
  error: AppErrorPayload;
}

/**
 * Route table. Single source of truth for paths, so the client never
 * hardcodes a string the server can silently rename out from under it.
 */
export const ROUTES = {
  health: "/api/health",
  probe: "/api/probe",
  jobs: "/api/jobs",
  job: (id: string) => `/api/jobs/${id}`,
  jobEvents: (id: string) => `/api/jobs/${id}/events`,
  cancelJob: (id: string) => `/api/jobs/${id}/cancel`,
  /** `token` is opaque and unguessable — it is the capability, not the job id. */
  file: (token: string) => `/api/files/${token}`,
} as const;
