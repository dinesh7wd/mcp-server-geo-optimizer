import { describe, expect, it } from "vitest";
import { DEFAULT_USER_AGENT, loadConfig } from "../../src/config.js";
import { ErrorCodes } from "../../src/utils/errors.js";
import { getLogLevel } from "../../src/utils/logger.js";

describe("config", () => {
  it("defaults to nominatim and documented values with an empty environment", () => {
    const cfg = loadConfig({});
    expect(cfg).toMatchObject({
      geocodingProvider: "nominatim",
      osrmUrl: "https://router.project-osrm.org",
      osrmMaxTableSize: 100,
      defaultSpeedKmh: 40,
      routeSearchTimeBudgetMs: 1500,
      cacheTtlSeconds: 300,
      httpTimeoutMs: 10_000,
      httpRetries: 2,
      publicApiMinIntervalMs: 1000,
      nodeEnv: "production",
      userAgent: DEFAULT_USER_AGENT,
    });
    expect(cfg.geocodingApiKey).toBeUndefined();
  });

  it("reads overrides, trims trailing slashes and applies the log level", () => {
    const cfg = loadConfig({
      GEOCODING_PROVIDER: "mapbox",
      GEOCODING_API_KEY: "pk.1",
      OSRM_URL: "http://localhost:5000/",
      OSRM_MAX_TABLE_SIZE: "500",
      HAVERSINE_SPEED_KMH: "55",
      GEO_USER_AGENT: "my-app/2.0 (ops@example.com)",
      PUBLIC_API_MIN_INTERVAL_MS: "1500",
      LOG_LEVEL: "debug",
      ROUTE_SEARCH_TIME_BUDGET_MS: "3000",
    });
    expect(cfg).toMatchObject({
      routeSearchTimeBudgetMs: 3000,
      geocodingProvider: "mapbox",
      geocodingApiKey: "pk.1",
      osrmUrl: "http://localhost:5000",
      osrmMaxTableSize: 500,
      defaultSpeedKmh: 55,
      userAgent: "my-app/2.0 (ops@example.com)",
      publicApiMinIntervalMs: 1500,
    });
    expect(getLogLevel()).toBe("debug");
  });

  it("rejects invalid values with PROVIDER_CONFIG", () => {
    expect(() => loadConfig({ GEOCODING_PROVIDER: "bing" })).toThrow(
      expect.objectContaining({ code: ErrorCodes.ProviderConfig }),
    );
    expect(() => loadConfig({ OSRM_URL: "file:///etc/passwd" })).toThrow(
      /OSRM_URL: must be an http\(s\) URL/,
    );
    expect(() => loadConfig({ PUBLIC_API_MIN_INTERVAL_MS: "10" })).toThrow(
      /PUBLIC_API_MIN_INTERVAL_MS/,
    );
  });

  it("requires an API key for google and mapbox", () => {
    expect(() => loadConfig({ GEOCODING_PROVIDER: "google" })).toThrow(
      /GEOCODING_API_KEY is required/,
    );
  });
});
