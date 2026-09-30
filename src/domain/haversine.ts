import type { Coord } from "./types.js";
import { DomainError } from "../utils/errors.js";
import { requireIndex } from "../utils/validators.js";

export const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function normalizeLng(lng: number): number {
  if (lng >= -180 && lng <= 180) {
    return lng;
  }
  const normalized = ((((lng + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 && lng > 0 ? 180 : normalized;
}

export function shortestLngDelta(fromLng: number, toLng: number): number {
  return normalizeLng(toLng - fromLng);
}

export function haversineKm(a: Coord, b: Coord): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(shortestLngDelta(a.lng, b.lng));
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function durationMin(distanceKm: number, speedKmh: number): number {
  if (speedKmh <= 0) {
    throw new DomainError("INVALID_SPEED", "averageSpeedKmh must be positive");
  }
  return (distanceKm / speedKmh) * 60;
}

export function sphericalMean(points: readonly Coord[]): Coord {
  if (points.length === 0) {
    throw new DomainError("EMPTY", "Cannot compute centroid of empty set");
  }
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    const lat = toRad(p.lat);
    const lng = toRad(p.lng);
    x += Math.cos(lat) * Math.cos(lng);
    y += Math.cos(lat) * Math.sin(lng);
    z += Math.sin(lat);
  }
  const hyp = Math.hypot(x, y);
  if (hyp < 1e-9 && Math.abs(z) < 1e-9) {
    const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), {
      lat: 0,
      lng: 0,
    });
    return { lat: sum.lat / points.length, lng: sum.lng / points.length };
  }
  return { lat: toDeg(Math.atan2(z, hyp)), lng: normalizeLng(toDeg(Math.atan2(y, x))) };
}

export function buildHaversineMatrix(
  origins: readonly Coord[],
  destinations: readonly Coord[],
  speedKmh: number,
): { distancesKm: number[][]; durationsMin: number[][] } {
  const distancesKm: number[][] = [];
  const durationsMin: number[][] = [];
  for (let i = 0; i < origins.length; i += 1) {
    const origin = requireIndex(origins, i, "origin");
    const distRow: number[] = [];
    const durRow: number[] = [];
    for (let j = 0; j < destinations.length; j += 1) {
      const dest = requireIndex(destinations, j, "destination");
      const km = haversineKm(origin, dest);
      distRow.push(km);
      durRow.push(durationMin(km, speedKmh));
    }
    distancesKm.push(distRow);
    durationsMin.push(durRow);
  }
  return { distancesKm, durationsMin };
}
