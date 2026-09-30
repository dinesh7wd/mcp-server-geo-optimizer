import { vi } from "vitest";
import { loadConfig, type AppConfig } from "../src/config.js";
import type { HttpClient, HttpRequest, HttpResponse } from "../src/infrastructure/httpClient.js";

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    GEOCODING_PROVIDER: "nominatim",
    OSRM_URL: "http://osrm.test",
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    ...overrides,
  });
}

export interface MockHttp extends HttpClient {
  readonly request: ReturnType<typeof vi.fn<(req: HttpRequest) => Promise<HttpResponse>>>;
}

export function mockHttp(...responses: HttpResponse[]): MockHttp {
  const request = vi.fn<(req: HttpRequest) => Promise<HttpResponse>>();
  for (const response of responses) {
    request.mockResolvedValueOnce(response);
  }
  return { request };
}

export function requestedUrl(http: MockHttp, call = 0): string {
  return http.request.mock.calls[call]?.[0].url ?? "";
}

export function captureStderr(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  return lines;
}

export function seededRandom(seed: number): () => number {
  let state = seed;
  return (): number => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}
