/**
 * Environment parsing, done once at boot.
 *
 * This app is the only place in the tool that reads `process.env`. The agent
 * package is a library and takes its configuration — including which provider
 * to talk to — as arguments.
 */

import path from "node:path";
import process from "node:process";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Chat backends this build knows how to construct.
 *
 * `scripted` is the default and answers from a fixed script — see
 * `ScriptedProvider`. It means a fresh clone runs with no key, no account and
 * no bill, and it is what CI uses. A real provider is a deliberate act.
 */
export const CHAT_PROVIDERS = ["scripted"] as const;
export type ChatProviderName = (typeof CHAT_PROVIDERS)[number];

export interface ApiConfig {
  host: string;
  port: number;

  /** SQLite file. `:memory:` is honoured, and is what the tests use. */
  databasePath: string;

  chatProvider: ChatProviderName;
  /** Ceiling on one reply. See `ChatRequest.maxOutputTokens`. */
  maxOutputTokens: number;

  /**
   * Built UI to serve from this process, same-origin. Undefined serves nothing,
   * which is a perfectly good headless configuration.
   */
  webDir: string | undefined;

  /** Origins allowed to call the API from a browser. Empty means same-origin only. */
  corsOrigins: readonly string[];
  logLevel: LogLevel;
}

export const API_DEFAULTS = {
  host: "127.0.0.1",
  // Not 8080: the downloader's API defaults there, and running both tools at
  // once should not need either of them reconfigured.
  port: 8090,
  dataDir: "./storage/planner",
  databaseFile: "planner.db",
  chatProvider: "scripted",
  maxOutputTokens: 2_048,
  logLevel: "info",
} as const satisfies Partial<Record<string, unknown>>;

function int(
  raw: string | undefined,
  fallback: number,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {},
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function optionalPath(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  return value === "" ? undefined : path.resolve(value);
}

function list(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function logLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? API_DEFAULTS.logLevel).trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(value) ? (value as LogLevel) : "info";
}

/**
 * An unknown provider name falls back to the scripted one rather than throwing.
 *
 * The opposite of how `PROXY_URL` is treated in the downloader, and for the
 * opposite reason: a typo there sends traffic out of the wrong address, while a
 * typo here can only mean the assistant is visibly scripted — which the health
 * endpoint reports, and which nobody will mistake for a working model.
 */
function chatProvider(raw: string | undefined): ChatProviderName {
  const value = (raw ?? API_DEFAULTS.chatProvider).trim().toLowerCase();
  return (CHAT_PROVIDERS as readonly string[]).includes(value)
    ? (value as ChatProviderName)
    : API_DEFAULTS.chatProvider;
}

export function loadApiConfig(
  overrides: Partial<ApiConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const rawDatabase = overrides.databasePath ?? env["DATABASE_PATH"];
  const databasePath =
    rawDatabase === ":memory:"
      ? ":memory:"
      : (rawDatabase ?? path.resolve(API_DEFAULTS.dataDir, API_DEFAULTS.databaseFile));

  return {
    host: overrides.host ?? env["HOST"] ?? API_DEFAULTS.host,
    port: overrides.port ?? int(env["PORT"], API_DEFAULTS.port, { min: 0, max: 65_535 }),
    databasePath,
    chatProvider: overrides.chatProvider ?? chatProvider(env["CHAT_PROVIDER"]),
    maxOutputTokens:
      overrides.maxOutputTokens ??
      int(env["MAX_OUTPUT_TOKENS"], API_DEFAULTS.maxOutputTokens, { max: 32_000 }),
    // Resolved so a relative WEB_DIR means the same thing wherever the process
    // was started from.
    webDir: overrides.webDir ?? optionalPath(env["WEB_DIR"]),
    corsOrigins: overrides.corsOrigins ?? list(env["CORS_ORIGINS"]),
    logLevel: overrides.logLevel ?? logLevel(env["LOG_LEVEL"]),
  };
}
