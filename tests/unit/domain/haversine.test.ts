import { describe, expect, it } from "vitest";
import {
  buildHaversineMatrix,
  durationMin,
  haversineKm,
  normalizeLng,
  shortestLngDelta,
  sphericalMean,
} from "../../../src/domain/haversine.js";
import { DomainError } from "../../../src/utils/errors.js";
import { eastOfDateLine, london, nullIsland, nyc, westOfDateLine } from "../../fixtures/coords.js";

describe("haversine", () => {
  it("computes NYC to London within 0.5% of the known great-circle distance", () => {
    expect(haversineKm(nyc, london)).toBeCloseTo(5570, -1);
  });

  it("returns zero for identical points including null island", () => {
    expect(haversineKm(nullIsland, nullIsland)).toBe(0);
  });

  it("uses the short arc across the antimeridian", () => {
    expect(haversineKm(westOfDateLine, eastOfDateLine)).toBeCloseTo(44.48, 1);
    expect(shortestLngDelta(179.8, -179.8)).toBeCloseTo(0.4, 9);
    expect(shortestLngDelta(-179, 179)).toBeCloseTo(-2, 9);
  });

  it("normalizes longitudes into [-180, 180]", () => {
    expect(normalizeLng(190)).toBeCloseTo(-170, 9);
    expect(normalizeLng(-190)).toBeCloseTo(170, 9);
    expect(normalizeLng(180)).toBe(180);
    expect(normalizeLng(-180)).toBe(-180);
    expect(normalizeLng(540)).toBe(180);
    expect(normalizeLng(1e6)).toBeCloseTo(-80, 6);
  });

  it("builds a symmetric matrix and durations", () => {
    const matrix = buildHaversineMatrix([nyc, london], [nyc, london], 60);
    expect(matrix.distancesKm[0]?.[1]).toBeCloseTo(matrix.distancesKm[1]?.[0] ?? 0, 9);
    expect(matrix.durationsMin[0]?.[1]).toBeCloseTo(matrix.distancesKm[0]?.[1] ?? 0, 9);
    expect(matrix.distancesKm[0]?.[0]).toBe(0);
  });

  it("rejects non-positive speed", () => {
    expect(() => durationMin(10, 0)).toThrow(DomainError);
    expect(durationMin(40, 40)).toBe(60);
  });
});

describe("sphericalMean", () => {
  it("returns the point itself for a single point", () => {
    const mean = sphericalMean([london]);
    expect(mean.lat).toBeCloseTo(london.lat, 9);
    expect(mean.lng).toBeCloseTo(london.lng, 9);
  });

  it("stays on the antimeridian for points straddling it", () => {
    const mean = sphericalMean([westOfDateLine, eastOfDateLine]);
    expect(Math.abs(mean.lng)).toBeCloseTo(180, 6);
    expect(mean.lat).toBeCloseTo(0, 9);
  });

  it("falls back to the arithmetic mean for antipodal points and rejects empty input", () => {
    expect(
      sphericalMean([
        { lat: 0, lng: 0 },
        { lat: 0, lng: 180 },
      ]),
    ).toEqual({ lat: 0, lng: 90 });
    expect(() => sphericalMean([])).toThrow(DomainError);
  });
});
