import { buildHaversineMatrix } from "../domain/haversine.js";
import type { OsrmClient } from "../infrastructure/osrmClient.js";
import { ErrorCodes, McpError, wrapError } from "../utils/errors.js";
import { roundMatrix } from "../utils/format.js";
import { MAX_MATRIX_CELLS, type DistanceMatrixInput } from "../utils/schemas.js";

export interface MatrixResult {
  readonly mode: "haversine" | "osrm";
  readonly averageSpeedKmh?: number;
  readonly distancesKm: number[][];
  readonly durationsMin: number[][];
}

export interface MatrixService {
  compute(input: DistanceMatrixInput): Promise<MatrixResult>;
}

export function createMatrixService(osrm: OsrmClient, defaultSpeedKmh: number): MatrixService {
  return {
    async compute(input: DistanceMatrixInput): Promise<MatrixResult> {
      try {
        const destinations = input.destinations ?? input.origins;
        const cells = input.origins.length * destinations.length;
        if (cells > MAX_MATRIX_CELLS) {
          throw new McpError(
            ErrorCodes.InvalidParams,
            `origins x destinations = ${cells} cells exceeds the limit of ${MAX_MATRIX_CELLS}`,
          );
        }
        if (input.mode === "haversine") {
          const speed = input.averageSpeedKmh ?? defaultSpeedKmh;
          const matrix = buildHaversineMatrix(input.origins, destinations, speed);
          return {
            mode: "haversine",
            averageSpeedKmh: speed,
            distancesKm: roundMatrix(matrix.distancesKm, 3),
            durationsMin: roundMatrix(matrix.durationsMin, 2),
          };
        }
        const table = await osrm.table(input.origins, input.destinations);
        return {
          mode: "osrm",
          distancesKm: roundMatrix(table.distancesKm, 3),
          durationsMin: roundMatrix(table.durationsMin, 2),
        };
      } catch (err) {
        throw wrapError(err, ErrorCodes.RouteFail);
      }
    },
  };
}
