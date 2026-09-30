import type { BoundingBox, Coord } from "./types.js";
import { DomainError } from "../utils/errors.js";
import { isFiniteNumber, requireIndex } from "../utils/validators.js";
import { haversineKm, normalizeLng } from "./haversine.js";

export interface LngWindow {
  readonly west: number;
  readonly east: number;
  readonly crosses: boolean;
}

type Position = [number, number, ...number[]];

const MAX_GEOJSON_DEPTH = 32;
const MAX_VALIDATION_ERRORS = 20;

function uniquePoints(points: readonly Coord[]): Coord[] {
  const seen = new Set<string>();
  const unique: Coord[] = [];
  for (const p of points) {
    const key = `${p.lat}:${normalizeLng(p.lng)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }
  return unique;
}

function cross(o: Coord, a: Coord, b: Coord): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

export function lngWindow(lngs: readonly number[]): LngWindow {
  const sorted = [...new Set(lngs.map(normalizeLng))].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) {
    throw new DomainError("EMPTY", "at least one longitude is required");
  }
  let gap = first + 360 - last;
  let west = first;
  let east = last;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = requireIndex(sorted, i - 1, "lng");
    const next = requireIndex(sorted, i, "lng");
    if (next - prev > gap) {
      gap = next - prev;
      west = next;
      east = prev;
    }
  }
  return { west, east, crosses: west > east };
}

function monotoneChain<T extends Coord>(pts: readonly T[]): T[] {
  const half = (source: readonly T[]): T[] => {
    const chain: T[] = [];
    for (const p of source) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2] as T, chain[chain.length - 1] as T, p) <= 0
      ) {
        chain.pop();
      }
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return half(pts).concat(half(pts.slice().reverse()));
}

export function convexHull(points: readonly Coord[]): Coord[] {
  const unique = uniquePoints(points);
  if (unique.length === 0) {
    return [];
  }
  const window = lngWindow(unique.map((p) => p.lng));
  const shifted = unique
    .map((p) => {
      const lng = normalizeLng(p.lng);
      return {
        lat: p.lat,
        lng: window.crosses && lng < window.west ? lng + 360 : lng,
        original: lng,
      };
    })
    .sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  const hull = shifted.length < 2 ? shifted : monotoneChain(shifted);
  return hull.map((p) => ({ lat: p.lat, lng: p.original }));
}

export function boundingBox(points: readonly Coord[]): BoundingBox {
  if (points.length === 0) {
    throw new DomainError("EMPTY", "bounding box requires at least one point");
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
  }
  const window = lngWindow(points.map((p) => p.lng));
  return {
    minLat,
    minLng: window.west,
    maxLat,
    maxLng: window.east,
    crossesAntimeridian: window.crosses,
  };
}

export function pointInPolygon(point: Coord, polygon: readonly Coord[]): boolean {
  if (polygon.length < 3) {
    throw new DomainError("DEGENERATE", "polygon requires at least 3 vertices");
  }
  const crossesAntimeridian = polygon.some(
    (v, i) => Math.abs(requireIndex(polygon, (i + 1) % polygon.length, "vertex").lng - v.lng) > 180,
  );
  const x = (lng: number): number => (crossesAntimeridian && lng < 0 ? lng + 360 : lng);
  const px = x(point.lng);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = requireIndex(polygon, i, "vertex");
    const b = requireIndex(polygon, j, "vertex");
    const ax = x(a.lng);
    const bx = x(b.lng);
    if (a.lat > point.lat !== b.lat > point.lat) {
      const edgeX = ((bx - ax) * (point.lat - a.lat)) / (b.lat - a.lat) + ax;
      if (px < edgeX) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function perpendicularDistance(point: Coord, start: Coord, end: Coord): number {
  const se = haversineKm(start, end);
  if (se === 0) {
    return haversineKm(point, start);
  }
  const sp = haversineKm(start, point);
  const ep = haversineKm(end, point);
  const s = (se + sp + ep) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - se) * (s - sp) * (s - ep)));
  return (2 * area) / se;
}

export function simplifyIndices(points: readonly Coord[], toleranceKm: number): number[] {
  if (points.length <= 2) {
    return points.map((_, i) => i);
  }
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  for (let range = stack.pop(); range !== undefined; range = stack.pop()) {
    const [first, last] = range;
    const start = requireIndex(points, first, "point");
    const end = requireIndex(points, last, "point");
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const dist = perpendicularDistance(requireIndex(points, i, "point"), start, end);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index !== -1 && maxDist > toleranceKm) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return keep.flatMap((kept, i) => (kept ? [i] : []));
}

export function simplifyPath(points: readonly Coord[], toleranceKm: number): Coord[] {
  return simplifyIndices(points, toleranceKm).map((i) => requireIndex(points, i, "point"));
}

export function isGeoJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "type" in value;
}

function isPosition(value: unknown): value is Position {
  return Array.isArray(value) && value.length >= 2 && value.every(isFiniteNumber);
}

interface ValidationContext {
  readonly errors: string[];
}

function report(ctx: ValidationContext, path: string, message: string): void {
  if (ctx.errors.length < MAX_VALIDATION_ERRORS) {
    ctx.errors.push(`${path}: ${message}`);
  }
}

function checkPosition(value: unknown, path: string, ctx: ValidationContext): void {
  if (!isPosition(value)) {
    report(ctx, path, "position must be an array of finite numbers [lng, lat] or [lng, lat, alt]");
    return;
  }
  if (value[0] < -180 || value[0] > 180) {
    report(ctx, path, `longitude ${value[0]} is outside -180..180`);
  }
  if (value[1] < -90 || value[1] > 90) {
    report(ctx, path, `latitude ${value[1]} is outside -90..90`);
  }
}

function checkArray(
  value: unknown,
  path: string,
  ctx: ValidationContext,
  check: (item: unknown, itemPath: string) => void,
): value is unknown[] {
  if (!Array.isArray(value)) {
    report(ctx, path, "must be an array");
    return false;
  }
  value.forEach((item, i) => check(item, `${path}[${i}]`));
  return true;
}

function checkPositions(value: unknown, path: string, ctx: ValidationContext, min: number): void {
  const valid = checkArray(value, path, ctx, (item, itemPath) =>
    checkPosition(item, itemPath, ctx),
  );
  if (valid && value.length > 0 && value.length < min) {
    report(ctx, path, `must contain at least ${min} positions`);
  }
}

function checkRing(value: unknown, path: string, ctx: ValidationContext): void {
  checkPositions(value, path, ctx, 4);
  if (!Array.isArray(value) || value.length < 4) {
    return;
  }
  const first: unknown = value[0];
  const last: unknown = value[value.length - 1];
  if (isPosition(first) && isPosition(last) && (first[0] !== last[0] || first[1] !== last[1])) {
    report(ctx, path, "linear ring must be closed (first and last positions equal)");
  }
}

function checkCoordinates(
  type: string,
  coords: unknown,
  path: string,
  ctx: ValidationContext,
): void {
  const ring = (item: unknown, itemPath: string): void => checkRing(item, itemPath, ctx);
  const line = (item: unknown, itemPath: string): void => checkPositions(item, itemPath, ctx, 2);
  switch (type) {
    case "Point":
      checkPosition(coords, path, ctx);
      return;
    case "MultiPoint":
      checkPositions(coords, path, ctx, 0);
      return;
    case "LineString":
      line(coords, path);
      return;
    case "MultiLineString":
      checkArray(coords, path, ctx, line);
      return;
    case "Polygon":
      checkArray(coords, path, ctx, ring);
      return;
    default:
      checkArray(coords, path, ctx, (poly, polyPath) => checkArray(poly, polyPath, ctx, ring));
  }
}

const COORDINATE_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
]);

function checkGeometry(value: unknown, path: string, ctx: ValidationContext, depth: number): void {
  if (!isGeoJsonObject(value)) {
    report(ctx, path, "must be a GeoJSON geometry object");
    return;
  }
  if (typeof value.type === "string" && COORDINATE_TYPES.has(value.type)) {
    checkCoordinates(value.type, value.coordinates, `${path}.coordinates`, ctx);
    return;
  }
  if (value.type !== "GeometryCollection") {
    report(ctx, path, `invalid geometry type ${JSON.stringify(value.type)}`);
    return;
  }
  if (depth >= MAX_GEOJSON_DEPTH) {
    report(ctx, path, `nesting deeper than ${MAX_GEOJSON_DEPTH} levels`);
    return;
  }
  checkArray(value.geometries, `${path}.geometries`, ctx, (item, itemPath) =>
    checkGeometry(item, itemPath, ctx, depth + 1),
  );
}

function checkFeature(value: unknown, path: string, ctx: ValidationContext): void {
  if (!isGeoJsonObject(value) || value.type !== "Feature") {
    report(ctx, path, "must be a GeoJSON Feature");
    return;
  }
  if (!("geometry" in value)) {
    report(ctx, `${path}.geometry`, "is required (use null for unlocated features)");
  } else if (value.geometry !== null) {
    checkGeometry(value.geometry, `${path}.geometry`, ctx, 1);
  }
  const props = value.properties;
  if (
    props !== undefined &&
    props !== null &&
    (typeof props !== "object" || Array.isArray(props))
  ) {
    report(ctx, `${path}.properties`, "must be an object or null");
  }
}

export function validateGeoJson(value: unknown): { valid: boolean; errors: string[] } {
  if (!isGeoJsonObject(value)) {
    return { valid: false, errors: ["value is not a GeoJSON object"] };
  }
  const ctx: ValidationContext = { errors: [] };
  if (value.type === "FeatureCollection") {
    checkArray(value.features, "features", ctx, (item, itemPath) =>
      checkFeature(item, itemPath, ctx),
    );
  } else if (value.type === "Feature") {
    checkFeature(value, "feature", ctx);
  } else {
    checkGeometry(value, "geometry", ctx, 0);
  }
  return { valid: ctx.errors.length === 0, errors: ctx.errors };
}

export function pointsToFeatureCollection(
  points: readonly { lat: number; lng: number; id?: string | undefined }[],
): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features: points.map((p, i) => ({
      type: "Feature",
      id: p.id ?? i,
      properties: p.id === undefined ? {} : { id: p.id },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    })),
  };
}

function simplifyLine(coords: unknown, toleranceKm: number, minPositions: number): unknown {
  if (!Array.isArray(coords) || !coords.every(isPosition)) {
    return coords;
  }
  const positions: Position[] = coords;
  const kept = simplifyIndices(
    positions.map((p) => ({ lng: p[0], lat: p[1] })),
    toleranceKm,
  );
  return kept.length < minPositions
    ? coords
    : kept.map((i) => requireIndex(positions, i, "position"));
}

function mapArray(value: unknown, fn: (item: unknown) => unknown): unknown {
  return Array.isArray(value) ? value.map(fn) : value;
}

function simplifyCoordinates(type: unknown, coords: unknown, toleranceKm: number): unknown {
  const line = (item: unknown): unknown => simplifyLine(item, toleranceKm, 2);
  const ring = (item: unknown): unknown => simplifyLine(item, toleranceKm, 4);
  switch (type) {
    case "LineString":
      return line(coords);
    case "MultiLineString":
      return mapArray(coords, line);
    case "Polygon":
      return mapArray(coords, ring);
    case "MultiPolygon":
      return mapArray(coords, (poly) => mapArray(poly, ring));
    default:
      return coords;
  }
}

export function simplifyGeoJson(
  value: Record<string, unknown>,
  toleranceKm: number,
): Record<string, unknown> {
  const child = (item: unknown): unknown =>
    isGeoJsonObject(item) ? simplifyGeoJson(item, toleranceKm) : item;
  switch (value.type) {
    case "Feature":
      return { ...value, geometry: child(value.geometry) };
    case "FeatureCollection":
      return { ...value, features: mapArray(value.features, child) };
    case "GeometryCollection":
      return { ...value, geometries: mapArray(value.geometries, child) };
    default:
      return "coordinates" in value
        ? { ...value, coordinates: simplifyCoordinates(value.type, value.coordinates, toleranceKm) }
        : value;
  }
}
