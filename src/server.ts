import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PUBLIC_API_HOSTS, SERVER_NAME, SERVER_VERSION, type AppConfig } from "./config.js";
import { LruCache } from "./infrastructure/cache.js";
import type { GeocodingClient } from "./infrastructure/geocodingClient.js";
import { createGeocodingClient } from "./infrastructure/geocodingClient.js";
import { createHttpClient, type HttpClient } from "./infrastructure/httpClient.js";
import type { OsrmClient } from "./infrastructure/osrmClient.js";
import { createOsrmClient } from "./infrastructure/osrmClient.js";
import { createBoundaryService } from "./services/boundaryService.js";
import { createClusterService } from "./services/clusterService.js";
import { createGeocodingService } from "./services/geocodingService.js";
import { createMatrixService } from "./services/matrixService.js";
import { createRoutingService } from "./services/routingService.js";
import { registerTools } from "./tools/index.js";
import type { AppServices } from "./tools/types.js";

export const CACHE_MAX_ENTRIES = 500;
export const CACHE_MAX_WEIGHT = 500_000;

export interface InfraOverrides {
  readonly http?: HttpClient;
  readonly osrm?: OsrmClient;
  readonly geocoding?: GeocodingClient;
  readonly cache?: LruCache;
}

export function createServices(config: AppConfig, overrides: InfraOverrides = {}): AppServices {
  const cache =
    overrides.cache ?? new LruCache(CACHE_MAX_ENTRIES, config.cacheTtlSeconds, CACHE_MAX_WEIGHT);
  const http =
    overrides.http ??
    createHttpClient({
      userAgent: config.userAgent,
      throttledHosts: new Map<string, number>(
        PUBLIC_API_HOSTS.map((host): [string, number] => [host, config.publicApiMinIntervalMs]),
      ),
    });
  const osrm = overrides.osrm ?? createOsrmClient(http, config, cache);
  const geocoding = overrides.geocoding ?? createGeocodingClient(http, config, cache);
  return {
    config,
    routing: createRoutingService(osrm, config.routeSearchTimeBudgetMs),
    geocoding: createGeocodingService(geocoding),
    matrix: createMatrixService(osrm, config.defaultSpeedKmh),
    cluster: createClusterService(),
    boundary: createBoundaryService(),
  };
}

export function createServer(config: AppConfig, overrides: InfraOverrides = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, createServices(config, overrides));
  return server;
}
