import type { Cluster, Coord, GeoPoint } from "./types.js";
import { DomainError } from "../utils/errors.js";
import { requireIndex } from "../utils/validators.js";
import { haversineKm, normalizeLng, sphericalMean } from "./haversine.js";

export interface KMeansOptions {
  readonly k: number;
  readonly seed: number;
  readonly maxIterations: number;
}

export interface DbscanOptions {
  readonly epsKm: number;
  readonly minPts: number;
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return (): number => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function countDistinct(points: readonly Coord[]): number {
  return new Set(points.map((p) => `${p.lat}:${normalizeLng(p.lng)}`)).size;
}

function nearestCentroid(point: Coord, centroids: readonly Coord[]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < centroids.length; i += 1) {
    const dist = haversineKm(point, requireIndex(centroids, i, "centroid"));
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function pickWeighted(
  points: readonly GeoPoint[],
  weights: readonly number[],
  rand: () => number,
): GeoPoint | undefined {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) {
    return undefined;
  }
  let threshold = rand() * total;
  let chosen: GeoPoint | undefined;
  for (let i = 0; i < points.length; i += 1) {
    const weight = requireIndex(weights, i, "weight");
    if (weight <= 0) {
      continue;
    }
    chosen = requireIndex(points, i, "point");
    threshold -= weight;
    if (threshold <= 0) {
      break;
    }
  }
  return chosen;
}

function initCentroids(points: readonly GeoPoint[], k: number, rand: () => number): Coord[] {
  const first = requireIndex(points, Math.floor(rand() * points.length), "point");
  const centroids: Coord[] = [{ lat: first.lat, lng: first.lng }];
  while (centroids.length < k) {
    const weights = points.map((p) => {
      const d = Math.min(...centroids.map((c) => haversineKm(p, c)));
      return d * d;
    });
    const chosen = pickWeighted(points, weights, rand);
    if (chosen === undefined) {
      break;
    }
    centroids.push({ lat: chosen.lat, lng: chosen.lng });
  }
  return centroids;
}

function group(
  points: readonly GeoPoint[],
  assignment: readonly number[],
  k: number,
): GeoPoint[][] {
  const groups: GeoPoint[][] = Array.from({ length: k }, () => []);
  assignment.forEach((clusterId, i) => {
    requireIndex(groups, clusterId, "group").push(requireIndex(points, i, "point"));
  });
  return groups;
}

export function kmeans(points: readonly GeoPoint[], options: KMeansOptions): readonly Cluster[] {
  if (options.k < 1) {
    throw new DomainError("INVALID_K", "k must be at least 1");
  }
  if (points.length === 0) {
    throw new DomainError("EMPTY", "kmeans requires at least one point");
  }
  const rand = mulberry32(options.seed);
  let centroids = initCentroids(points, Math.min(options.k, countDistinct(points)), rand);
  let assignment = points.map((p) => nearestCentroid(p, centroids));
  for (let iter = 0; iter < options.maxIterations; iter += 1) {
    const next = group(points, assignment, centroids.length).map((members, i) =>
      members.length === 0 ? requireIndex(centroids, i, "centroid") : sphericalMean(members),
    );
    const nextAssign = points.map((p) => nearestCentroid(p, next));
    const changed = nextAssign.some((id, i) => id !== assignment[i]);
    centroids = next;
    assignment = nextAssign;
    if (!changed) {
      break;
    }
  }
  return group(points, assignment, centroids.length)
    .filter((members) => members.length > 0)
    .map((members, id) => ({ id, centroid: sphericalMean(members), points: members }));
}

function regionQuery(points: readonly GeoPoint[], index: number, epsKm: number): number[] {
  const origin = requireIndex(points, index, "point");
  const neighbors: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (haversineKm(origin, requireIndex(points, i, "point")) <= epsKm) {
      neighbors.push(i);
    }
  }
  return neighbors;
}

export function dbscan(points: readonly GeoPoint[], options: DbscanOptions): readonly Cluster[] {
  if (options.epsKm <= 0) {
    throw new DomainError("INVALID_EPS", "epsKm must be positive");
  }
  const labels = new Array<number>(points.length).fill(-2);
  let clusterId = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (requireIndex(labels, i, "label") !== -2) {
      continue;
    }
    const neighbors = regionQuery(points, i, options.epsKm);
    if (neighbors.length < options.minPts) {
      labels[i] = -1;
      continue;
    }
    labels[i] = clusterId;
    expandCluster(points, labels, neighbors, clusterId, options);
    clusterId += 1;
  }
  return clustersFromLabels(points, labels, clusterId);
}

function expandCluster(
  points: readonly GeoPoint[],
  labels: number[],
  seedNeighbors: readonly number[],
  clusterId: number,
  options: DbscanOptions,
): void {
  const seeds = seedNeighbors.slice();
  const queued = new Set(seeds);
  for (let s = 0; s < seeds.length; s += 1) {
    const q = requireIndex(seeds, s, "seed");
    if (labels[q] === -1) {
      labels[q] = clusterId;
    }
    if (labels[q] !== -2) {
      continue;
    }
    labels[q] = clusterId;
    const qNeighbors = regionQuery(points, q, options.epsKm);
    if (qNeighbors.length >= options.minPts) {
      for (const n of qNeighbors) {
        if (!queued.has(n)) {
          queued.add(n);
          seeds.push(n);
        }
      }
    }
  }
}

function clustersFromLabels(
  points: readonly GeoPoint[],
  labels: readonly number[],
  clusterCount: number,
): Cluster[] {
  const clusters: Cluster[] = [];
  for (let id = 0; id < clusterCount; id += 1) {
    const members = points.filter((_, i) => labels[i] === id);
    clusters.push({ id, centroid: sphericalMean(members), points: members });
  }
  const noise = points.filter((_, i) => labels[i] === -1);
  if (noise.length > 0) {
    clusters.push({
      id: clusterCount,
      centroid: sphericalMean(noise),
      points: noise,
      noise: true,
    });
  }
  return clusters;
}
