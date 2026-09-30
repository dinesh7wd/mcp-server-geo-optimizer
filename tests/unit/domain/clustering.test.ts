import { describe, expect, it } from "vitest";
import { countDistinct, dbscan, kmeans, mulberry32 } from "../../../src/domain/clustering.js";
import { DomainError } from "../../../src/utils/errors.js";

const clustered = [
  { lat: 0, lng: 0, id: "a" },
  { lat: 0.01, lng: 0.01, id: "b" },
  { lat: 10, lng: 10, id: "c" },
  { lat: 10.01, lng: 10.01, id: "d" },
];

const dateLine = [
  { lat: 0, lng: 179.9, id: "w" },
  { lat: 0, lng: -179.9, id: "e" },
  { lat: 0.01, lng: 179.95, id: "w2" },
];

function ids(
  clusters: readonly { points: readonly { id?: string | undefined }[] }[],
): (string | undefined)[][] {
  return clusters.map((c) => c.points.map((p) => p.id));
}

describe("kmeans", () => {
  it("is deterministic for the same seed and separates obvious groups", () => {
    const a = kmeans(clustered, { k: 2, seed: 42, maxIterations: 50 });
    const b = kmeans(clustered, { k: 2, seed: 42, maxIterations: 50 });
    expect(ids(a)).toEqual(ids(b));
    expect(
      ids(a)
        .map((group) => [...group].sort())
        .sort(),
    ).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a seeded rng in range", () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 20; i += 1) {
      const n = rand();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  it("rejects invalid k", () => {
    expect(() => kmeans(clustered, { k: 9, seed: 1, maxIterations: 10 })).toThrow(DomainError);
    expect(() => kmeans(clustered, { k: 0, seed: 1, maxIterations: 10 })).toThrow(DomainError);
  });

  it("clamps k to distinct points instead of returning empty clusters", () => {
    const duplicates = [
      { lat: 1, lng: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 1 },
    ];
    const clusters = kmeans(duplicates, { k: 3, seed: 1, maxIterations: 50 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.points).toHaveLength(3);
    const mixed = [...duplicates, { lat: 5, lng: 5 }];
    expect(
      kmeans(mixed, { k: 3, seed: 1, maxIterations: 50 })
        .map((c) => c.points.length)
        .sort(),
    ).toEqual([1, 3]);
    expect(countDistinct(mixed)).toBe(2);
  });

  it("computes date-line safe centroids", () => {
    const [cluster] = kmeans(dateLine, { k: 1, seed: 1, maxIterations: 50 });
    expect(Math.abs(cluster?.centroid.lng ?? 0)).toBeGreaterThan(179.9);
    expect(cluster?.centroid.lat).toBeCloseTo(0.00333, 4);
  });
});

describe("dbscan", () => {
  it("marks distant points as noise", () => {
    const result = dbscan([...clustered, { lat: 40, lng: 40, id: "noise" }], {
      epsKm: 20,
      minPts: 2,
    });
    expect(result).toHaveLength(3);
    const noise = result.find((c) => c.noise === true);
    expect(ids(noise === undefined ? [] : [noise])).toEqual([["noise"]]);
  });

  it("expands chains through core points and reclaims border points", () => {
    const chain = Array.from({ length: 5 }, (_, i) => ({ lat: 0, lng: i * 0.05, id: String(i) }));
    const clusters = dbscan(chain, { epsKm: 6, minPts: 2 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.points).toHaveLength(5);
    const border = dbscan(
      [
        { lat: 0, lng: 0.1, id: "edge" },
        { lat: 0, lng: 0, id: "c1" },
        { lat: 0, lng: 0.01, id: "c2" },
        { lat: 0, lng: 0.02, id: "c3" },
      ],
      { epsKm: 9, minPts: 3 },
    );
    expect(border.find((c) => c.noise === true)).toBeUndefined();
    expect(border[0]?.points.map((p) => p.id).sort()).toEqual(["c1", "c2", "c3", "edge"]);
  });

  it("computes date-line safe centroids", () => {
    const [cluster] = dbscan(dateLine, { epsKm: 50, minPts: 2 });
    expect(Math.abs(cluster?.centroid.lng ?? 0)).toBeGreaterThan(179.9);
  });

  it("rejects non-positive eps", () => {
    expect(() => dbscan(clustered, { epsKm: 0, minPts: 2 })).toThrow(DomainError);
  });
});
