/**
 * Transport selection. This is the whole mock-to-real switch.
 *
 * `VITE_API_MOCK` decides, and it is read at *build* time — a bundle carries
 * its answer, it is not a runtime setting. The default therefore differs by
 * mode, and deliberately:
 *
 *  - **dev: mocked.** `npm run dev -w @downloader/web` needs no backend at
 *    all, which is what let the UI ship before the API existed. Set
 *    `VITE_API_MOCK=false` in `.env.local` to point it at a running API.
 *  - **build: real.** A production bundle that silently faked every download
 *    would be a container that looks perfectly healthy and does nothing, and
 *    the mistake would be found by a user rather than by a test. `docker
 *    compose up` must not be able to ship the mock by omission.
 *
 * Either default can still be overridden explicitly; only the omission case
 * changes. Nothing else in the app knows which transport it is talking to —
 * everything goes through `ApiClient`.
 */

import { createHttpClient } from "./http.ts";
import { createMockClient } from "./mock.ts";
import type { ApiClient } from "./types.ts";

const env = import.meta.env;

export const USING_MOCK_API = String(env.VITE_API_MOCK ?? String(env.DEV)) !== "false";

export const api: ApiClient = USING_MOCK_API
  ? createMockClient({ speed: Number(env.VITE_MOCK_SPEED ?? 1) || 1 })
  : createHttpClient({ baseUrl: String(env.VITE_API_BASE_URL ?? "") });
