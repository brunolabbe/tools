/**
 * Which assistant this server is running.
 *
 * It stays on the page now that there is a wizard beside it: a scripted
 * assistant must never be mistakable for a real one, and "which provider is
 * configured" is the first question anyone asks about a bad plan.
 */

import { ROUTES } from "@planner/contract";
import { requestJson } from "./client.ts";

export interface HealthSummary {
  ok: boolean;
  version: string;
  provider: string;
  model: string;
}

interface HealthBody {
  ok: boolean;
  version: string;
  agent: { provider: string; model: string };
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthSummary> {
  const health = await requestJson<HealthBody>(ROUTES.health, { signal });
  return {
    ok: health.ok,
    version: health.version,
    provider: health.agent.provider,
    model: health.agent.model,
  };
}
