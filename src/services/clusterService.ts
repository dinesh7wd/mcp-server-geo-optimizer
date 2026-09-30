import { dbscan, kmeans } from "../domain/clustering.js";
import type { Cluster, Coord, GeoPoint } from "../domain/types.js";
import { ErrorCodes, McpError, wrapError } from "../utils/errors.js";
import { roundDeg } from "../utils/format.js";
import type { ClusterPointsInput } from "../utils/schemas.js";

export interface ClusterOutput {
  readonly id: number;
  readonly size: number;
  readonly centroid: Coord;
  readonly points: readonly GeoPoint[];
  readonly noise?: boolean;
}

export interface ClusterService {
  cluster(input: ClusterPointsInput): readonly ClusterOutput[];
}

function present(cluster: Cluster): ClusterOutput {
  return {
    id: cluster.id,
    size: cluster.points.length,
    centroid: { lat: roundDeg(cluster.centroid.lat), lng: roundDeg(cluster.centroid.lng) },
    points: cluster.points,
    ...(cluster.noise === true ? { noise: true } : {}),
  };
}

function run(input: ClusterPointsInput): readonly Cluster[] {
  if (input.algorithm === "kmeans") {
    if (input.k === undefined) {
      throw new McpError(ErrorCodes.InvalidParams, "k is required for kmeans");
    }
    return kmeans(input.points, { k: input.k, seed: input.seed, maxIterations: 50 });
  }
  if (input.epsKm === undefined) {
    throw new McpError(ErrorCodes.InvalidParams, "epsKm is required for dbscan");
  }
  return dbscan(input.points, { epsKm: input.epsKm, minPts: input.minPts ?? 2 });
}

export function createClusterService(): ClusterService {
  return {
    cluster(input: ClusterPointsInput): readonly ClusterOutput[] {
      try {
        return run(input).map(present);
      } catch (err) {
        throw wrapError(err, ErrorCodes.ClusterFail);
      }
    },
  };
}
