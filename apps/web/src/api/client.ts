/**
 * Transport selection. This is the whole mock-to-real switch.
 *
 * Set `VITE_API_MOCK=false` (and optionally `VITE_API_BASE_URL`) to point the
 * UI at `apps/api`. Nothing else in the app knows which transport it is talking
 * to — everything goes through `ApiClient`.
 */

import { createHttpClient } from "./http.ts";
import { createMockClient } from "./mock.ts";
import type { ApiClient } from "./types.ts";

const env = import.meta.env;

export const USING_MOCK_API = String(env.VITE_API_MOCK ?? "true") !== "false";

export const api: ApiClient = USING_MOCK_API
  ? createMockClient({ speed: Number(env.VITE_MOCK_SPEED ?? 1) || 1 })
  : createHttpClient({ baseUrl: String(env.VITE_API_BASE_URL ?? "") });
