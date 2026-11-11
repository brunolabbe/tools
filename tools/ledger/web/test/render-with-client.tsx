/**
 * Renders a screen inside a fresh query cache (lg-98). Each test gets its own:
 * one shared between tests would hand a test the answers another one mocked,
 * and it would pass on that test's data. Retries are off, so a failure shows at
 * once; the app's other defaults (`query.ts`) are kept, `staleTime` included.
 */

import { render } from "@testing-library/react";
import type { RenderOptions, RenderResult } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "../src/query.ts";

export function testQueryClient(): QueryClient {
  const client = createQueryClient();
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  return client;
}

/** A provider of `client`, for `render`'s or `renderHook`'s `wrapper`. */
export function clientWrapper(
  client: QueryClient = testQueryClient(),
): (props: { children: React.ReactNode }) => React.ReactElement {
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function renderWithClient(
  ui: React.ReactElement,
  options: Omit<RenderOptions, "wrapper"> & { client?: QueryClient } = {},
): RenderResult & { client: QueryClient } {
  const { client = testQueryClient(), ...rest } = options;
  return { ...render(ui, { ...rest, wrapper: clientWrapper(client) }), client };
}
