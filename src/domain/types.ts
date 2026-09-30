export interface Coord {
  readonly lat: number;
  readonly lng: number;
}

export interface GeoPoint extends Coord {
  readonly id?: string | undefined;
}

export interface Waypoint extends GeoPoint {
  readonly demand?: number | undefined;
  readonly readyTimeMin?: number | undefined;
  readonly dueTimeMin?: number | undefined;
  readonly serviceTimeMin?: number | undefined;
}

export interface RouteStop {
  readonly index: number;
  readonly id?: string | undefined;
  readonly arrivalMin: number;
  readonly waitMin: number;
  readonly departureMin: number;
  readonly lateMin?: number | undefined;
}

export interface TimeWindowViolation {
  readonly index: number;
  readonly arrivalMin: number;
  readonly dueTimeMin: number;
  readonly lateMin: number;
  readonly returnToDepot?: boolean | undefined;
}

export interface Route {
  readonly vehicleId: number;
  readonly stops: readonly RouteStop[];
  readonly distanceKm: number;
  readonly durationMin: number;
  readonly demand: number;
  readonly violations: readonly TimeWindowViolation[];
}

export interface Cluster {
  readonly id: number;
  readonly centroid: Coord;
  readonly points: readonly GeoPoint[];
  readonly noise?: boolean | undefined;
}

export interface BoundingBox {
  readonly minLat: number;
  readonly minLng: number;
  readonly maxLat: number;
  readonly maxLng: number;
  readonly crossesAntimeridian: boolean;
}

export interface DistanceMatrix {
  readonly distancesKm: readonly (readonly number[])[];
  readonly durationsMin: readonly (readonly number[])[];
}

export interface TspResult {
  readonly order: readonly number[];
  readonly distanceKm: number;
}

export interface VrpResult {
  readonly routes: readonly Route[];
  readonly unassigned: readonly number[];
  readonly totalDistanceKm: number;
  readonly totalDurationMin: number;
  readonly feasible: boolean;
}
