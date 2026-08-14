/**
 * The one call the UI can make today.
 *
 * It exists so the wiring is provable end to end — contract types imported from
 * the same package the server validates against, the dev proxy forwarding
 * `/api`, a real response rendered — rather than a shell that has never spoken
 * to its backend. The rest of the client lands with the routes it calls.
 */

import { ROUTES, errorPayloadSchema } from "@planner/contract";
import { AppError } from "@planner/contract";

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
  let response: Response;
  try {
    response = await fetch(ROUTES.health, {
      headers: { accept: "application/json" },
      ...(signal ? { signal } : {}),
    });
  } catch (cause: unknown) {
    // A failed `fetch` is indistinguishable from the server being down, so say
    // that rather than guessing at something more specific.
    throw new AppError("UNREACHABLE", "The planner API is not answering.", { cause });
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // The server's own taxonomy, when it sent one — a 503 from a draining
    // instance says something more useful than "request failed".
    const parsed = errorPayloadSchema.safeParse((body as { error?: unknown } | null)?.error);
    if (parsed.success) throw new AppError(parsed.data.code, parsed.data.message);
    throw new AppError("INTERNAL", `The API answered ${String(response.status)}.`);
  }

  const health = body as HealthBody;
  return {
    ok: health.ok,
    version: health.version,
    provider: health.agent.provider,
    model: health.agent.model,
  };
}
