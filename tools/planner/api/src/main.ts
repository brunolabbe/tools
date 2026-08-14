/**
 * Process entry point: listen, and shut down cleanly when asked.
 *
 * Everything interesting is in `server.ts`. This file exists to own the two
 * things a library must never own — the socket and the signal handlers.
 */

import process from "node:process";
import { AppError } from "@planner/contract";
import { createApp } from "./server.ts";

/** How long a shutdown may take before the process exits anyway. */
const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  const app = await createApp();
  const { config, context } = app;

  await app.server.listen({ host: config.host, port: config.port });
  context.logger.info("listening", {
    host: config.host,
    port: config.port,
    databasePath: config.databasePath,
    provider: context.model.name,
  });

  let shuttingDown = false;
  const stop = (signal: string): void => {
    if (shuttingDown) {
      // A second Ctrl-C means "I meant it".
      context.logger.warn("second signal received; exiting immediately", { signal });
      process.exit(1);
    }
    shuttingDown = true;
    context.logger.info("signal received", { signal });

    const forceExit = setTimeout(() => {
      context.logger.error("shutdown timed out; exiting", { graceMs: SHUTDOWN_GRACE_MS });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    void app
      .shutdown()
      .then(() => {
        clearTimeout(forceExit);
        process.exit(0);
      })
      .catch((error: unknown) => {
        context.logger.error("shutdown failed", { error: String(error) });
        process.exit(1);
      });
  };

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

main().catch((error: unknown) => {
  const appError = AppError.from(error);
  // No logger yet if `createApp` was what failed, so this is the one place a
  // direct write is the only option. The *underlying* error is reported, not
  // just the taxonomy's copy: a startup failure is read by an operator, and
  // "Something went wrong on our end" for what is usually EADDRINUSE costs an
  // hour of someone's life for no reason.
  const cause = appError.cause ?? error;
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      time: new Date().toISOString(),
      msg: "failed to start",
      code: appError.code,
      error: appError.message,
      reason: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
      details: appError.details,
    })}\n`,
  );
  process.exit(1);
});
