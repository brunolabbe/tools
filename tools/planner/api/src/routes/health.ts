/**
 * `GET /api/health`.
 *
 * Reports what a deployment needs to know: whether the database opened, which
 * assistant is actually answering, and what — if anything — is checking its
 * answers against the world.
 *
 * `ok` is deliberately narrow — it goes false only when the service genuinely
 * cannot do its job, and on the way down so a load balancer stops sending
 * traffic before the sockets close. A *scripted* provider is not unhealthy: it
 * is a legitimate configuration, and it is what CI runs. It is reported by name
 * so nobody mistakes it for a model. The grounding provider is beside it for
 * exactly the same reason: `fixtures` answers from a checked-in table, and a
 * deployment that meant to configure a real backend needs to be able to see
 * that it did not.
 *
 * **Never a key and never an endpoint.** This route is unauthenticated. The
 * provider's name is all it may say, which is also all `GroundingProvider`
 * exposes — the seam carries no other field, so there is nothing here to
 * remember not to print.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROUTES } from "@planner/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";

export interface HealthResponse {
  ok: boolean;
  shuttingDown: boolean;
  version: string;
  uptimeSec: number;
  agent: { provider: string; model: string };
  grounding: { provider: string };
  database: { path: string; open: boolean };
}

/**
 * Read once, from the package manifest, so the reported version cannot drift
 * from the one that was released. Failure is not fatal: an unknown version is a
 * worse health response, not a dead service.
 */
function readVersion(): string {
  try {
    const manifest = fileURLToPath(new URL("../../package.json", import.meta.url));
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const VERSION = readVersion();

export function registerHealthRoute(app: FastifyInstance, context: AppContext): void {
  app.get(ROUTES.health, async (_request, reply) => {
    const body: HealthResponse = {
      ok: context.db.open && !context.isShuttingDown(),
      shuttingDown: context.isShuttingDown(),
      version: VERSION,
      uptimeSec: Math.round((context.now().getTime() - context.startedAt.getTime()) / 1000),
      agent: { provider: context.model.name, model: context.model.model },
      grounding: { provider: context.grounding.name },
      database: { path: context.config.databasePath, open: context.db.open },
    };
    // 503 while draining so a load balancer stops sending traffic before the
    // sockets actually close.
    return await reply.code(body.ok ? 200 : 503).send(body);
  });
}
