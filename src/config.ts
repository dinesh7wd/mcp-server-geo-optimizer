import { z } from "zod";
import { ErrorCodes, McpError } from "./utils/errors.js";
import { setLogLevel, type LogLevel } from "./utils/logger.js";

export const SERVER_NAME = "mcp-server-geo-optimizer";
export const SERVER_VERSION = "1.0.0";
export const DEFAULT_USER_AGENT = `${SERVER_NAME}/${SERVER_VERSION} (set GEO_USER_AGENT to include contact details)`;
export const PUBLIC_API_HOSTS: readonly string[] = [
  "nominatim.openstreetmap.org",
  "router.project-osrm.org",
];

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const providerSchema = z.enum(["nominatim", "google", "mapbox"]);

export interface AppConfig {
  readonly geocodingProvider: "nominatim" | "google" | "mapbox";
  readonly geocodingApiKey?: string;
  readonly osrmUrl: string;
  readonly osrmMaxTableSize: number;
  readonly defaultSpeedKmh: number;
  readonly routeSearchTimeBudgetMs: number;
  readonly logLevel: LogLevel;
  readonly cacheTtlSeconds: number;
  readonly httpTimeoutMs: number;
  readonly httpRetries: number;
  readonly publicApiMinIntervalMs: number;
  readonly nodeEnv: "development" | "production" | "test";
  readonly userAgent: string;
}

const envSchema = z.object({
  GEOCODING_PROVIDER: providerSchema.default("nominatim"),
  GEOCODING_API_KEY: z.string().min(1).optional(),
  OSRM_URL: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), "must be an http(s) URL")
    .default("https://router.project-osrm.org"),
  OSRM_MAX_TABLE_SIZE: z.coerce.number().int().min(2).max(10_000).default(100),
  HAVERSINE_SPEED_KMH: z.coerce.number().positive().max(300).default(40),
  ROUTE_SEARCH_TIME_BUDGET_MS: z.coerce.number().int().min(50).max(30_000).default(1500),
  GEO_USER_AGENT: z.string().min(1).max(256).default(DEFAULT_USER_AGENT),
  PUBLIC_API_MIN_INTERVAL_MS: z.coerce.number().int().min(1000).max(60_000).default(1000),
  LOG_LEVEL: logLevelSchema.default("info"),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  HTTP_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new McpError(ErrorCodes.ProviderConfig, `Invalid environment: ${message}`);
  }
  const data = parsed.data;
  if (data.GEOCODING_PROVIDER !== "nominatim" && data.GEOCODING_API_KEY === undefined) {
    throw new McpError(
      ErrorCodes.ProviderConfig,
      `GEOCODING_API_KEY is required for provider ${data.GEOCODING_PROVIDER}`,
    );
  }
  setLogLevel(data.LOG_LEVEL);
  const config: AppConfig = {
    geocodingProvider: data.GEOCODING_PROVIDER,
    osrmUrl: data.OSRM_URL.replace(/\/+$/, ""),
    osrmMaxTableSize: data.OSRM_MAX_TABLE_SIZE,
    defaultSpeedKmh: data.HAVERSINE_SPEED_KMH,
    routeSearchTimeBudgetMs: data.ROUTE_SEARCH_TIME_BUDGET_MS,
    logLevel: data.LOG_LEVEL,
    cacheTtlSeconds: data.CACHE_TTL_SECONDS,
    httpTimeoutMs: data.HTTP_TIMEOUT_MS,
    httpRetries: data.HTTP_RETRIES,
    publicApiMinIntervalMs: data.PUBLIC_API_MIN_INTERVAL_MS,
    nodeEnv: data.NODE_ENV,
    userAgent: data.GEO_USER_AGENT,
  };
  if (data.GEOCODING_API_KEY !== undefined) {
    return { ...config, geocodingApiKey: data.GEOCODING_API_KEY };
  }
  return config;
}
