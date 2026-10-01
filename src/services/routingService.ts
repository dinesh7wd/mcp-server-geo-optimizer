import type { OsrmClient } from "../infrastructure/osrmClient.js";
import {
  DEFAULT_SEARCH_TIME_BUDGET_MS,
  distanceMatrixFromCoords,
  solveVrp,
  type CostMatrices,
} from "../domain/tspSolver.js";
import type { Route, RouteStop, TimeWindowViolation, VrpResult } from "../domain/types.js";
import { ErrorCodes, wrapError } from "../utils/errors.js";
import { roundKm, roundMin } from "../utils/format.js";
import type { OptimizeRouteInput } from "../utils/schemas.js";

export interface OptimizeRouteResult {
  readonly distanceSource: "osrm" | "haversine";
  readonly feasible: boolean;
  readonly totalDistanceKm: number;
  readonly totalDurationMin: number;
  readonly unassigned: readonly number[];
  readonly routes: readonly Route[];
}

export interface RoutingService {
  optimize(input: OptimizeRouteInput): Promise<OptimizeRouteResult>;
}

function roundStop(stop: RouteStop): RouteStop {
  return {
    ...stop,
    arrivalMin: roundMin(stop.arrivalMin),
    waitMin: roundMin(stop.waitMin),
    departureMin: roundMin(stop.departureMin),
    ...(stop.lateMin === undefined ? {} : { lateMin: roundMin(stop.lateMin) }),
  };
}

function roundViolation(violation: TimeWindowViolation): TimeWindowViolation {
  return {
    ...violation,
    arrivalMin: roundMin(violation.arrivalMin),
    lateMin: roundMin(violation.lateMin),
  };
}

function present(
  result: VrpResult,
  source: OptimizeRouteResult["distanceSource"],
): OptimizeRouteResult {
  return {
    distanceSource: source,
    feasible: result.feasible,
    totalDistanceKm: roundKm(result.totalDistanceKm),
    totalDurationMin: roundMin(result.totalDurationMin),
    unassigned: result.unassigned,
    routes: result.routes.map((route) => ({
      ...route,
      distanceKm: roundKm(route.distanceKm),
      durationMin: roundMin(route.durationMin),
      stops: route.stops.map(roundStop),
      violations: route.violations.map(roundViolation),
    })),
  };
}

export function createRoutingService(
  osrm: OsrmClient,
  timeBudgetMs: number = DEFAULT_SEARCH_TIME_BUDGET_MS,
): RoutingService {
  return {
    async optimize(input: OptimizeRouteInput): Promise<OptimizeRouteResult> {
      try {
        const matrices: CostMatrices = input.useOsrm
          ? await osrm.table(input.waypoints)
          : { distancesKm: distanceMatrixFromCoords(input.waypoints) };
        const result = solveVrp(input.waypoints, matrices, {
          vehicleCount: input.vehicleCount,
          capacity: input.capacity,
          closed: input.closed,
          startIndex: input.startIndex,
          averageSpeedKmh: input.averageSpeedKmh,
          timeBudgetMs,
        });
        return present(result, input.useOsrm ? "osrm" : "haversine");
      } catch (err) {
        throw wrapError(err, ErrorCodes.RouteFail);
      }
    },
  };
}
