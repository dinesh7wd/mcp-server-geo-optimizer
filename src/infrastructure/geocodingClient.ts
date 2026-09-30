import type { AppConfig } from "../config.js";
import type { Coord } from "../domain/types.js";
import { ErrorCodes, McpError } from "../utils/errors.js";
import type { LruCache } from "./cache.js";
import type { HttpClient } from "./httpClient.js";

export interface GeocodeHit {
  readonly lat: number;
  readonly lng: number;
  readonly displayName: string;
  readonly provider: string;
}

export interface GeocodingClient {
  forward(address: string, limit: number): Promise<readonly GeocodeHit[]>;
  reverse(coord: Coord): Promise<GeocodeHit>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function createGeocodingClient(
  http: HttpClient,
  config: AppConfig,
  cache: LruCache,
): GeocodingClient {
  return {
    async forward(address: string, limit: number): Promise<readonly GeocodeHit[]> {
      const key = `geo:fwd:${config.geocodingProvider}:${limit}:${address}`;
      const cached = cache.get<readonly GeocodeHit[]>(key);
      if (cached !== undefined) {
        return cached;
      }
      const hits = await forwardByProvider(http, config, address, limit);
      cache.set(key, hits);
      return hits;
    },
    async reverse(coord: Coord): Promise<GeocodeHit> {
      const key = `geo:rev:${config.geocodingProvider}:${coord.lat},${coord.lng}`;
      const cached = cache.get<GeocodeHit>(key);
      if (cached !== undefined) {
        return cached;
      }
      const hit = await reverseByProvider(http, config, coord);
      cache.set(key, hit);
      return hit;
    },
  };
}

async function forwardByProvider(
  http: HttpClient,
  config: AppConfig,
  address: string,
  limit: number,
): Promise<readonly GeocodeHit[]> {
  if (config.geocodingProvider === "nominatim") {
    return nominatimForward(http, config, address, limit);
  }
  if (config.geocodingProvider === "google") {
    return googleForward(http, config, address, limit);
  }
  return mapboxForward(http, config, address, limit);
}

async function reverseByProvider(
  http: HttpClient,
  config: AppConfig,
  coord: Coord,
): Promise<GeocodeHit> {
  if (config.geocodingProvider === "nominatim") {
    return nominatimReverse(http, config, coord);
  }
  if (config.geocodingProvider === "google") {
    return googleReverse(http, config, coord);
  }
  return mapboxReverse(http, config, coord);
}

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const JSON_HEADERS = { Accept: "application/json" } as const;

function fail(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new McpError(ErrorCodes.GeocodingFailed, message, details);
}

async function nominatimForward(
  http: HttpClient,
  config: AppConfig,
  address: string,
  limit: number,
): Promise<readonly GeocodeHit[]> {
  const url = `${NOMINATIM_BASE}/search?format=jsonv2&limit=${limit}&q=${encodeURIComponent(address)}`;
  const res = await http.request({
    url,
    headers: JSON_HEADERS,
    timeoutMs: config.httpTimeoutMs,
    retries: config.httpRetries,
  });
  if (res.status !== 200 || !Array.isArray(res.body)) {
    fail("Nominatim search failed", { status: res.status });
  }
  const hits = res.body.flatMap((item) => {
    const hit = parseNominatim(item, config.geocodingProvider);
    return hit === undefined ? [] : [hit];
  });
  if (hits.length === 0) {
    fail("No geocoding results");
  }
  return hits;
}

async function nominatimReverse(
  http: HttpClient,
  config: AppConfig,
  coord: Coord,
): Promise<GeocodeHit> {
  const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${coord.lat}&lon=${coord.lng}`;
  const res = await http.request({
    url,
    headers: JSON_HEADERS,
    timeoutMs: config.httpTimeoutMs,
    retries: config.httpRetries,
  });
  const hit = parseNominatim(res.body, config.geocodingProvider);
  if (res.status !== 200 || hit === undefined) {
    fail("Nominatim reverse geocoding failed", { status: res.status });
  }
  return hit;
}

function parseNominatim(value: unknown, provider: string): GeocodeHit | undefined {
  const rec = asRecord(value);
  const lat = num(rec.lat);
  const lng = num(rec.lon);
  if (lat === undefined || lng === undefined) {
    return undefined;
  }
  return {
    lat,
    lng,
    displayName: typeof rec.display_name === "string" ? rec.display_name : `${lat},${lng}`,
    provider,
  };
}

function requireKey(config: AppConfig): string {
  if (config.geocodingApiKey === undefined) {
    throw new McpError(ErrorCodes.ProviderConfig, "GEOCODING_API_KEY is required");
  }
  return config.geocodingApiKey;
}

async function googleForward(
  http: HttpClient,
  config: AppConfig,
  address: string,
  limit: number,
): Promise<readonly GeocodeHit[]> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${requireKey(config)}`;
  const hits = await googleHits(http, config, url);
  return hits.slice(0, limit);
}

async function googleReverse(
  http: HttpClient,
  config: AppConfig,
  coord: Coord,
): Promise<GeocodeHit> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coord.lat},${coord.lng}&key=${requireKey(config)}`;
  const hits = await googleHits(http, config, url);
  const first = hits[0];
  if (first === undefined) {
    fail("No reverse geocoding results");
  }
  return first;
}

async function googleHits(
  http: HttpClient,
  config: AppConfig,
  url: string,
): Promise<readonly GeocodeHit[]> {
  const res = await http.request({
    url,
    timeoutMs: config.httpTimeoutMs,
    retries: config.httpRetries,
  });
  const body = asRecord(res.body);
  if (res.status === 200 && body.status === "ZERO_RESULTS") {
    fail("No geocoding results");
  }
  if (res.status !== 200 || body.status !== "OK" || !Array.isArray(body.results)) {
    fail("Google geocoding failed", { status: res.status, providerStatus: body.status });
  }
  const hits = body.results.flatMap((item) => {
    const rec = asRecord(item);
    const loc = asRecord(asRecord(rec.geometry).location);
    const lat = num(loc.lat);
    const lng = num(loc.lng);
    if (lat === undefined || lng === undefined) {
      return [];
    }
    return [
      {
        lat,
        lng,
        displayName:
          typeof rec.formatted_address === "string" ? rec.formatted_address : `${lat},${lng}`,
        provider: config.geocodingProvider,
      },
    ];
  });
  if (hits.length === 0) {
    fail("No geocoding results");
  }
  return hits;
}

async function mapboxForward(
  http: HttpClient,
  config: AppConfig,
  address: string,
  limit: number,
): Promise<readonly GeocodeHit[]> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?limit=${limit}&access_token=${requireKey(config)}`;
  return mapboxHits(http, config, url);
}

async function mapboxReverse(
  http: HttpClient,
  config: AppConfig,
  coord: Coord,
): Promise<GeocodeHit> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${coord.lng},${coord.lat}.json?limit=1&access_token=${requireKey(config)}`;
  const hits = await mapboxHits(http, config, url);
  const first = hits[0];
  if (first === undefined) {
    fail("No reverse geocoding results");
  }
  return first;
}

async function mapboxHits(
  http: HttpClient,
  config: AppConfig,
  url: string,
): Promise<readonly GeocodeHit[]> {
  const res = await http.request({
    url,
    timeoutMs: config.httpTimeoutMs,
    retries: config.httpRetries,
  });
  const body = asRecord(res.body);
  if (res.status !== 200 || !Array.isArray(body.features)) {
    fail("Mapbox geocoding failed", { status: res.status });
  }
  const hits = body.features.flatMap((item) => {
    const rec = asRecord(item);
    if (!Array.isArray(rec.center) || rec.center.length < 2) {
      return [];
    }
    const lng = num(rec.center[0]);
    const lat = num(rec.center[1]);
    if (lat === undefined || lng === undefined) {
      return [];
    }
    return [
      {
        lat,
        lng,
        displayName: typeof rec.place_name === "string" ? rec.place_name : `${lat},${lng}`,
        provider: config.geocodingProvider,
      },
    ];
  });
  if (hits.length === 0) {
    fail("No geocoding results");
  }
  return hits;
}
