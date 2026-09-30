import type { AppConfig } from "../config.js";
import type { Coord } from "../domain/types.js";
import { ErrorCodes, McpError } from "../utils/errors.js";
import { isFiniteNumber } from "../utils/validators.js";
import type { LruCache } from "./cache.js";
import type { HttpClient, HttpResponse } from "./httpClient.js";

export interface OsrmTableResult {
  readonly distancesKm: readonly (readonly number[])[];
  readonly durationsMin: readonly (readonly number[])[];
}

export interface OsrmClient {
  table(sources: readonly Coord[], destinations?: readonly Coord[]): Promise<OsrmTableResult>;
}

type RawMatrix = readonly (readonly (number | null)[])[];

function encodeCoords(coords: readonly Coord[]): string {
  return coords.map((c) => `${c.lng},${c.lat}`).join(";");
}

function indexList(from: number, to: number): string {
  return Array.from({ length: to - from }, (_, i) => from + i).join(";");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function matrixOf(value: unknown, rows: number, cols: number): RawMatrix | undefined {
  if (!Array.isArray(value) || value.length !== rows) {
    return undefined;
  }
  const valid = value.every(
    (row) =>
      Array.isArray(row) &&
      row.length === cols &&
      row.every((cell) => cell === null || isFiniteNumber(cell)),
  );
  return valid ? (value as RawMatrix) : undefined;
}

function hasNull(matrix: RawMatrix): boolean {
  return matrix.some((row) => row.some((cell) => cell === null));
}

function scale(matrix: RawMatrix, divisor: number): number[][] {
  return matrix.map((row) => row.map((cell) => (cell ?? 0) / divisor));
}

export function assertTableSize(sources: number, destinations: number, max: number): void {
  if (sources > max || destinations > max) {
    throw new McpError(
      ErrorCodes.InvalidParams,
      `OSRM table of ${sources} sources x ${destinations} destinations exceeds OSRM_MAX_TABLE_SIZE=${max}; ` +
        "use fewer locations or raise the limit for a self-hosted OSRM server",
    );
  }
}

function parseTable(res: HttpResponse, rows: number, cols: number): OsrmTableResult {
  const body = asRecord(res.body);
  const distances = matrixOf(body.distances, rows, cols);
  const durations = matrixOf(body.durations, rows, cols);
  if (
    res.status !== 200 ||
    body.code !== "Ok" ||
    distances === undefined ||
    durations === undefined
  ) {
    throw new McpError(ErrorCodes.RouteFail, "OSRM table request failed", {
      status: res.status,
      code: typeof body.code === "string" ? body.code : null,
      message: typeof body.message === "string" ? body.message : null,
    });
  }
  if (hasNull(distances) || hasNull(durations)) {
    throw new McpError(
      ErrorCodes.RouteFail,
      "OSRM found no road route between some of the locations",
    );
  }
  return { distancesKm: scale(distances, 1000), durationsMin: scale(durations, 60) };
}

export function createOsrmClient(http: HttpClient, config: AppConfig, cache: LruCache): OsrmClient {
  return {
    async table(
      sources: readonly Coord[],
      destinations?: readonly Coord[],
    ): Promise<OsrmTableResult> {
      const targets = destinations ?? sources;
      assertTableSize(sources.length, targets.length, config.osrmMaxTableSize);
      const coords = destinations === undefined ? sources : sources.concat(destinations);
      const selection =
        destinations === undefined
          ? ""
          : `&sources=${indexList(0, sources.length)}&destinations=${indexList(sources.length, coords.length)}`;
      const path = encodeCoords(coords);
      const key = `osrm:table:${path}${selection}`;
      const cached = cache.get<OsrmTableResult>(key);
      if (cached !== undefined) {
        return cached;
      }
      const res = await http.request({
        url: `${config.osrmUrl}/table/v1/driving/${path}?annotations=duration,distance${selection}`,
        timeoutMs: config.httpTimeoutMs,
        retries: config.httpRetries,
      });
      const result = parseTable(res, sources.length, targets.length);
      cache.set(key, result, sources.length * targets.length * 2);
      return result;
    },
  };
}
