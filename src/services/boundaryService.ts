import {
  boundingBox,
  convexHull,
  isGeoJsonObject,
  pointInPolygon,
  pointsToFeatureCollection,
  simplifyGeoJson,
  validateGeoJson,
} from "../domain/geometry.js";
import { ErrorCodes, McpError, wrapError } from "../utils/errors.js";
import type { BoundaryCheckInput, GeojsonUtilsInput } from "../utils/schemas.js";

export interface BoundaryService {
  check(input: BoundaryCheckInput): unknown;
  geojson(input: GeojsonUtilsInput): unknown;
}

function check(input: BoundaryCheckInput): unknown {
  if (input.operation === "point_in_polygon") {
    if (input.point === undefined || input.polygon === undefined) {
      throw new McpError(ErrorCodes.InvalidParams, "point and polygon are required");
    }
    return { inside: pointInPolygon(input.point, input.polygon) };
  }
  if (input.points === undefined) {
    throw new McpError(ErrorCodes.InvalidParams, "points are required");
  }
  if (input.operation === "convex_hull") {
    return { hull: convexHull(input.points) };
  }
  return { bbox: boundingBox(input.points) };
}

function geojson(input: GeojsonUtilsInput): unknown {
  if (input.operation === "to_feature_collection") {
    if (input.points === undefined) {
      throw new McpError(ErrorCodes.InvalidParams, "points are required");
    }
    return pointsToFeatureCollection(input.points);
  }
  if (input.geojson === undefined) {
    throw new McpError(ErrorCodes.InvalidParams, "geojson is required");
  }
  const validation = validateGeoJson(input.geojson);
  if (input.operation === "validate") {
    return validation;
  }
  if (!isGeoJsonObject(input.geojson) || !validation.valid) {
    throw new McpError(
      ErrorCodes.InvalidParams,
      `Invalid GeoJSON: ${validation.errors.slice(0, 5).join("; ")}`,
    );
  }
  return simplifyGeoJson(input.geojson, input.toleranceKm);
}

export function createBoundaryService(): BoundaryService {
  return {
    check(input: BoundaryCheckInput): unknown {
      try {
        return check(input);
      } catch (err) {
        throw wrapError(err, ErrorCodes.GeometryFail);
      }
    },
    geojson(input: GeojsonUtilsInput): unknown {
      try {
        return geojson(input);
      } catch (err) {
        throw wrapError(err, ErrorCodes.GeometryFail);
      }
    },
  };
}
