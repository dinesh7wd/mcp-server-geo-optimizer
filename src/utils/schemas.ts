import { z } from "zod";

export const MAX_MATRIX_CELLS = 2500;
export const MAX_GEOJSON_CHARS = 2_000_000;

type CoordShape = { lat: z.ZodNumber; lng: z.ZodNumber };
type PointShape = CoordShape & { id: z.ZodOptional<z.ZodString> };
type WaypointShape = PointShape & {
  demand: z.ZodOptional<z.ZodNumber>;
  readyTimeMin: z.ZodOptional<z.ZodNumber>;
  dueTimeMin: z.ZodOptional<z.ZodNumber>;
  serviceTimeMin: z.ZodOptional<z.ZodNumber>;
};

function latitude(): z.ZodNumber {
  return z.number().gte(-90).lte(90).describe("Latitude in decimal degrees (WGS84), -90 to 90");
}

function longitude(): z.ZodNumber {
  return z
    .number()
    .gte(-180)
    .lte(180)
    .describe("Longitude in decimal degrees (WGS84), -180 to 180");
}

function coordShape(): CoordShape {
  return { lat: latitude(), lng: longitude() };
}

function pointShape(): PointShape {
  return {
    ...coordShape(),
    id: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe("Optional identifier echoed back in results"),
  };
}

export function coordSchema(description: string): z.ZodObject<CoordShape> {
  return z.object(coordShape()).describe(description);
}

export function pointSchema(description: string): z.ZodObject<PointShape> {
  return z.object(pointShape()).describe(description);
}

function minutes(description: string): z.ZodOptional<z.ZodNumber> {
  return z.number().nonnegative().max(1_000_000).optional().describe(description);
}

function waypointSchema(): z.ZodObject<WaypointShape> {
  return z
    .object({
      ...pointShape(),
      demand: z
        .number()
        .nonnegative()
        .optional()
        .describe("Load this stop takes from vehicle capacity (same unit as capacity). Default 0"),
      readyTimeMin: minutes(
        "Earliest service start in minutes after route start; the vehicle waits if early. Must not exceed dueTimeMin",
      ),
      dueTimeMin: minutes(
        "Latest arrival in minutes after route start. On the depot with closed=true it is the latest return time",
      ),
      serviceTimeMin: minutes("Minutes spent at the stop. Default 0"),
    })
    .describe("Stop to visit");
}

export const optimizeRouteInputSchema = z
  .object({
    waypoints: z
      .array(waypointSchema())
      .min(2)
      .max(200)
      .describe(
        "Stops including the depot at startIndex (2-200). With useOsrm the limit is OSRM_MAX_TABLE_SIZE (default 100)",
      ),
    vehicleCount: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(1)
      .describe(
        "Number of vehicles. Stops are split into balanced angular sectors around the depot",
      ),
    capacity: z
      .number()
      .positive()
      .optional()
      .describe("Per-vehicle capacity in the same unit as waypoint demand. Omit for unlimited"),
    closed: z
      .boolean()
      .default(true)
      .describe("true = every vehicle returns to the depot; false = routes end at their last stop"),
    startIndex: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe(
        "Index in waypoints of the depot where every route starts; must be less than waypoints.length",
      ),
    averageSpeedKmh: z
      .number()
      .positive()
      .max(300)
      .default(40)
      .describe("Average speed in km/h used for travel times when useOsrm is false"),
    useOsrm: z
      .boolean()
      .default(false)
      .describe(
        "Use OSRM road distances and durations instead of straight-line estimates (network call)",
      ),
  })
  .superRefine((value, ctx) => {
    if (value.startIndex >= value.waypoints.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `startIndex must be less than the number of waypoints (${value.waypoints.length})`,
        path: ["startIndex"],
      });
    }
    value.waypoints.forEach((w, i) => {
      if (
        w.readyTimeMin !== undefined &&
        w.dueTimeMin !== undefined &&
        w.readyTimeMin > w.dueTimeMin
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "readyTimeMin must not be greater than dueTimeMin",
          path: ["waypoints", i, "readyTimeMin"],
        });
      }
    });
  });

export const geocodeInputSchema = z
  .object({
    address: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe("Address or place name for forward geocoding. Omit when passing lat/lng"),
    lat: z
      .number()
      .gte(-90)
      .lte(90)
      .optional()
      .describe("Latitude in decimal degrees for reverse geocoding (use with lng)"),
    lng: z
      .number()
      .gte(-180)
      .lte(180)
      .optional()
      .describe("Longitude in decimal degrees for reverse geocoding (use with lat)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(1)
      .describe("Maximum number of forward-geocoding results (1-10). Ignored for reverse"),
  })
  .superRefine((value, ctx) => {
    const hasAddress = value.address !== undefined;
    const hasLat = value.lat !== undefined;
    const hasLng = value.lng !== undefined;
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "lat and lng must be provided together",
      });
    } else if (hasAddress === hasLat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either address (forward) or lat+lng (reverse), not both or neither",
      });
    }
  });

export const distanceMatrixInputSchema = z
  .object({
    origins: z
      .array(coordSchema("Origin location"))
      .min(1)
      .max(100)
      .describe(
        `Origin locations (1-100). origins x destinations must not exceed ${MAX_MATRIX_CELLS} cells`,
      ),
    destinations: z
      .array(coordSchema("Destination location"))
      .min(1)
      .max(100)
      .optional()
      .describe("Destination locations (1-100). Omit for an origins x origins matrix"),
    mode: z
      .enum(["haversine", "osrm"])
      .default("haversine")
      .describe(
        "haversine = straight-line km with minutes at averageSpeedKmh; osrm = road km/minutes from the OSRM server",
      ),
    averageSpeedKmh: z
      .number()
      .positive()
      .max(300)
      .optional()
      .describe("Speed in km/h for haversine durations. Defaults to HAVERSINE_SPEED_KMH (40)"),
  })
  .superRefine((value, ctx) => {
    const cells = value.origins.length * (value.destinations ?? value.origins).length;
    if (cells > MAX_MATRIX_CELLS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `origins x destinations = ${cells} cells exceeds the limit of ${MAX_MATRIX_CELLS}; split the request into batches`,
      });
    }
  });

export const clusterPointsInputSchema = z
  .object({
    points: z
      .array(pointSchema("Point to cluster"))
      .min(1)
      .max(500)
      .describe("Points to cluster (1-500)"),
    algorithm: z
      .enum(["kmeans", "dbscan"])
      .describe(
        "kmeans = k clusters; dbscan = density clusters within epsKm, isolated points returned as noise",
      ),
    k: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Number of clusters (required for kmeans). Reduced to the number of distinct points if larger",
      ),
    epsKm: z
      .number()
      .positive()
      .max(20_000)
      .optional()
      .describe("Neighborhood radius in km (required for dbscan)"),
    minPts: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Minimum neighbors including the point itself for a dbscan core point. Default 2"),
    seed: z.number().int().default(42).describe("Random seed that makes kmeans deterministic"),
  })
  .superRefine((value, ctx) => {
    if (value.algorithm === "kmeans" && value.k === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "k is required for kmeans",
        path: ["k"],
      });
    }
    if (value.algorithm === "dbscan" && value.epsKm === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "epsKm is required for dbscan",
        path: ["epsKm"],
      });
    }
  });

export const boundaryCheckInputSchema = z
  .object({
    operation: z
      .enum(["point_in_polygon", "convex_hull", "bounding_box"])
      .describe("point_in_polygon needs point + polygon; convex_hull and bounding_box need points"),
    point: coordSchema("Point to test for point_in_polygon").optional(),
    points: z
      .array(coordSchema("Input point"))
      .min(1)
      .max(5000)
      .optional()
      .describe("Points for convex_hull or bounding_box (1-5000)"),
    polygon: z
      .array(coordSchema("Polygon vertex"))
      .min(3)
      .max(5000)
      .optional()
      .describe(
        "Polygon vertices in order as {lat,lng} objects (3-5000). Closing vertex optional; no holes",
      ),
  })
  .superRefine((value, ctx) => {
    if (
      value.operation === "point_in_polygon" &&
      (value.point === undefined || value.polygon === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "point_in_polygon requires point and polygon",
      });
    }
    if (value.operation !== "point_in_polygon" && value.points === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${value.operation} requires points` });
    }
  });

export const geojsonUtilsInputSchema = z
  .object({
    operation: z
      .enum(["validate", "simplify", "to_feature_collection"])
      .describe(
        "validate = RFC 7946 structure and coordinate ranges; simplify = Douglas-Peucker on lines and rings; to_feature_collection = points to Point features",
      ),
    geojson: z
      .unknown()
      .optional()
      .describe(
        `GeoJSON object with [lng, lat] coordinates, for validate and simplify (at most ${MAX_GEOJSON_CHARS} characters as JSON)`,
      ),
    points: z
      .array(pointSchema("Point to convert"))
      .min(1)
      .max(1000)
      .optional()
      .describe("Points for to_feature_collection (1-1000)"),
    toleranceKm: z
      .number()
      .nonnegative()
      .max(1000)
      .default(0.05)
      .describe("Simplification tolerance in km (default 0.05 = 50 m)"),
  })
  .superRefine((value, ctx) => {
    if (value.geojson !== undefined && JSON.stringify(value.geojson).length > MAX_GEOJSON_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `geojson exceeds ${MAX_GEOJSON_CHARS} characters`,
        path: ["geojson"],
      });
    }
  });

export type OptimizeRouteInput = z.infer<typeof optimizeRouteInputSchema>;
export type GeocodeInput = z.infer<typeof geocodeInputSchema>;
export type DistanceMatrixInput = z.infer<typeof distanceMatrixInputSchema>;
export type ClusterPointsInput = z.infer<typeof clusterPointsInputSchema>;
export type BoundaryCheckInput = z.infer<typeof boundaryCheckInputSchema>;
export type GeojsonUtilsInput = z.infer<typeof geojsonUtilsInputSchema>;

export function zodToErrorMessage(err: z.ZodError): string {
  return err.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
}
