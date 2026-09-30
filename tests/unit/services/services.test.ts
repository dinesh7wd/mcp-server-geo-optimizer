import { describe, expect, it, vi } from "vitest";
import type { GeocodingClient } from "../../../src/infrastructure/geocodingClient.js";
import type { OsrmClient } from "../../../src/infrastructure/osrmClient.js";
import { createBoundaryService } from "../../../src/services/boundaryService.js";
import { createClusterService } from "../../../src/services/clusterService.js";
import { createGeocodingService } from "../../../src/services/geocodingService.js";
import { createMatrixService } from "../../../src/services/matrixService.js";
import { createRoutingService } from "../../../src/services/routingService.js";
import { ErrorCodes, McpError } from "../../../src/utils/errors.js";
import { unitSquare } from "../../fixtures/coords.js";

const triangle = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.2 },
  { lat: 0.2, lng: 0 },
];

const routeDefaults = {
  vehicleCount: 1,
  closed: true,
  startIndex: 0,
  averageSpeedKmh: 40,
} as const;

function osrmWith(table: OsrmClient["table"]): OsrmClient {
  return { table };
}

describe("routingService", () => {
  it("optimizes with haversine without calling OSRM and rounds output", async () => {
    const table = vi.fn();
    const result = await createRoutingService(osrmWith(table)).optimize({
      ...routeDefaults,
      waypoints: triangle,
      useOsrm: false,
    });
    expect(table).not.toHaveBeenCalled();
    expect(result.distanceSource).toBe("haversine");
    expect(result.routes).toHaveLength(1);
    expect(result.totalDistanceKm).toBe(Math.round(result.totalDistanceKm * 1000) / 1000);
    expect(result.totalDistanceKm).toBeCloseTo(75.93, 1);
  });

  it("reports OSRM road distances and durations when useOsrm is set", async () => {
    const table = vi.fn().mockResolvedValue({
      distancesKm: [
        [0, 10, 20],
        [10, 0, 15],
        [20, 15, 0],
      ],
      durationsMin: [
        [0, 12, 24],
        [12, 0, 18],
        [24, 18, 0],
      ],
    });
    const result = await createRoutingService(osrmWith(table)).optimize({
      ...routeDefaults,
      waypoints: triangle,
      useOsrm: true,
    });
    expect(table).toHaveBeenCalledWith(triangle);
    expect(result.distanceSource).toBe("osrm");
    expect(result.totalDistanceKm).toBe(45);
    expect(result.totalDurationMin).toBe(54);
  });

  it("preserves upstream error codes such as TIMEOUT", async () => {
    const table = vi.fn().mockRejectedValue(new McpError(ErrorCodes.Timeout, "slow"));
    await expect(
      createRoutingService(osrmWith(table)).optimize({
        ...routeDefaults,
        waypoints: triangle,
        useOsrm: true,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.Timeout });
  });

  it("maps unexpected failures to ROUTE_FAIL and domain errors to InvalidParams", async () => {
    const down = createRoutingService(osrmWith(vi.fn().mockRejectedValue(new Error("down"))));
    await expect(
      down.optimize({ ...routeDefaults, waypoints: triangle, useOsrm: true }),
    ).rejects.toMatchObject({
      code: ErrorCodes.RouteFail,
    });
    const local = createRoutingService(osrmWith(vi.fn()));
    await expect(
      local.optimize({ ...routeDefaults, waypoints: triangle, startIndex: 9, useOsrm: false }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
  });

  it("rounds stop times and violations", async () => {
    const result = await createRoutingService(osrmWith(vi.fn())).optimize({
      ...routeDefaults,
      closed: false,
      waypoints: [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1, dueTimeMin: 1 },
      ],
      useOsrm: false,
    });
    const stop = result.routes[0]?.stops[1];
    expect(stop?.arrivalMin).toBe(Math.round((stop?.arrivalMin ?? 0) * 100) / 100);
    expect(result.routes[0]?.violations[0]?.lateMin).toBe(stop?.lateMin);
    expect(result.feasible).toBe(false);
  });
});

describe("matrixService", () => {
  it("computes a rounded haversine matrix with the configured default speed", async () => {
    const osrm = osrmWith(vi.fn());
    const matrix = await createMatrixService(osrm, 60).compute({
      origins: [{ lat: 0, lng: 0 }],
      destinations: [{ lat: 0, lng: 1 }],
      mode: "haversine",
    });
    expect(matrix).toEqual({
      mode: "haversine",
      averageSpeedKmh: 60,
      distancesKm: [[111.195]],
      durationsMin: [[111.19]],
    });
    expect(osrm.table).not.toHaveBeenCalled();
  });

  it("honours a per-request speed", async () => {
    const matrix = await createMatrixService(osrmWith(vi.fn()), 60).compute({
      origins: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
      ],
      mode: "haversine",
      averageSpeedKmh: 30,
    });
    expect(matrix.averageSpeedKmh).toBe(30);
    expect(matrix.durationsMin[0]?.[1]).toBeCloseTo(222.39, 2);
  });

  it("passes sources and destinations to OSRM separately", async () => {
    const table = vi
      .fn()
      .mockResolvedValue({ distancesKm: [[1.23456, 2]], durationsMin: [[3.14159, 4]] });
    const origins = [{ lat: 0, lng: 0 }];
    const destinations = [
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ];
    const matrix = await createMatrixService(osrmWith(table), 40).compute({
      origins,
      destinations,
      mode: "osrm",
    });
    expect(table).toHaveBeenCalledWith(origins, destinations);
    expect(matrix).toEqual({ mode: "osrm", distancesKm: [[1.235, 2]], durationsMin: [[3.14, 4]] });
  });

  it("rejects matrices above the cell cap and preserves upstream codes", async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ lat: 0, lng: i * 0.01 }));
    const service = createMatrixService(
      osrmWith(vi.fn().mockRejectedValue(new McpError(ErrorCodes.Timeout, "slow"))),
      40,
    );
    await expect(
      service.compute({ origins: many, destinations: many, mode: "haversine" }),
    ).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
    await expect(
      service.compute({ origins: [{ lat: 0, lng: 0 }], mode: "osrm" }),
    ).rejects.toMatchObject({
      code: ErrorCodes.Timeout,
    });
    const down = createMatrixService(osrmWith(vi.fn().mockRejectedValue(new Error("down"))), 40);
    await expect(
      down.compute({ origins: [{ lat: 0, lng: 0 }], mode: "osrm" }),
    ).rejects.toMatchObject({
      code: ErrorCodes.RouteFail,
    });
  });
});

describe("geocodingService", () => {
  const hit = { lat: 1, lng: 2, displayName: "A", provider: "nominatim" };

  it("delegates forward and reverse geocoding", async () => {
    const client: GeocodingClient = {
      forward: vi.fn().mockResolvedValue([hit]),
      reverse: vi.fn().mockResolvedValue(hit),
    };
    const service = createGeocodingService(client);
    expect(await service.geocode({ address: "A", limit: 3 })).toEqual([hit]);
    expect(client.forward).toHaveBeenCalledWith("A", 3);
    expect(await service.geocode({ lat: 1, lng: 2, limit: 1 })).toEqual([hit]);
    expect(client.reverse).toHaveBeenCalledWith({ lat: 1, lng: 2 });
  });

  it("rejects reverse geocoding without coordinates and preserves client error codes", async () => {
    const client: GeocodingClient = {
      forward: vi.fn().mockRejectedValue(new McpError(ErrorCodes.Timeout, "slow")),
      reverse: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const service = createGeocodingService(client);
    await expect(service.geocode({ limit: 1 })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
    await expect(service.geocode({ address: "x", limit: 1 })).rejects.toMatchObject({
      code: ErrorCodes.Timeout,
    });
    await expect(service.geocode({ lat: 1, lng: 1, limit: 1 })).rejects.toMatchObject({
      code: ErrorCodes.GeocodingFailed,
      message: "boom",
    });
  });
});

describe("clusterService", () => {
  const points = [
    { lat: 0, lng: 0, id: "a" },
    { lat: 0, lng: 0.01, id: "b" },
    { lat: 5, lng: 5, id: "c" },
    { lat: 5, lng: 5.01, id: "d" },
  ];

  it("clusters with kmeans and reports size and rounded centroids", () => {
    const clusters = createClusterService().cluster({ points, algorithm: "kmeans", k: 2, seed: 7 });
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.size)).toEqual([2, 2]);
    for (const cluster of clusters) {
      expect(cluster.centroid.lng).toBe(Math.round(cluster.centroid.lng * 1e6) / 1e6);
    }
  });

  it("clusters with dbscan and flags noise", () => {
    const clusters = createClusterService().cluster({
      points: [...points, { lat: 40, lng: 40, id: "far" }],
      algorithm: "dbscan",
      epsKm: 5,
      seed: 1,
    });
    expect(clusters.map((c) => c.points.map((p) => p.id))).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["far"],
    ]);
    expect(clusters[2]?.noise).toBe(true);
    expect(clusters[0]).not.toHaveProperty("noise");
  });

  it("requires k for kmeans and epsKm for dbscan with InvalidParams", () => {
    const service = createClusterService();
    expect(() => service.cluster({ points, algorithm: "kmeans", seed: 1 })).toThrow(
      /k is required/,
    );
    expect(() => service.cluster({ points, algorithm: "dbscan", seed: 1 })).toThrow(
      /epsKm is required/,
    );
    expect(() => service.cluster({ points, algorithm: "kmeans", k: 10, seed: 1 })).toThrow(
      expect.objectContaining({ code: ErrorCodes.InvalidParams }),
    );
  });
});

describe("boundaryService", () => {
  const service = createBoundaryService();

  it("reports point in polygon", () => {
    expect(
      service.check({
        operation: "point_in_polygon",
        point: { lat: 0.5, lng: 0.5 },
        polygon: [...unitSquare],
      }),
    ).toEqual({
      inside: true,
    });
  });

  it("returns a convex hull and bounding box", () => {
    const hull = service.check({
      operation: "convex_hull",
      points: [...unitSquare, { lat: 0.5, lng: 0.5 }],
    }) as {
      hull: unknown[];
    };
    expect(hull.hull).toHaveLength(4);
    expect(service.check({ operation: "bounding_box", points: [...unitSquare] })).toEqual({
      bbox: { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1, crossesAntimeridian: false },
    });
  });

  it("validates, simplifies, and converts GeoJSON", () => {
    expect(
      service.geojson({
        operation: "validate",
        geojson: { type: "Point", coordinates: [0, 0] },
        toleranceKm: 0.05,
      }),
    ).toEqual({
      valid: true,
      errors: [],
    });
    const simplified = service.geojson({
      operation: "simplify",
      geojson: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [0.0001, 0],
          [1, 0],
        ],
      },
      toleranceKm: 1,
    });
    expect(simplified).toEqual({
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 0],
      ],
    });
    const fc = service.geojson({
      operation: "to_feature_collection",
      points: [{ lat: 1, lng: 2, id: "p" }],
      toleranceKm: 0.05,
    });
    expect(fc).toMatchObject({
      type: "FeatureCollection",
      features: [{ geometry: { coordinates: [2, 1] } }],
    });
  });

  it("fails fast with InvalidParams on missing or invalid inputs", () => {
    const invalid = expect.objectContaining({ code: ErrorCodes.InvalidParams });
    expect(() => service.check({ operation: "convex_hull" })).toThrow(invalid);
    expect(() => service.check({ operation: "point_in_polygon" })).toThrow(invalid);
    expect(() => service.geojson({ operation: "validate", toleranceKm: 0.05 })).toThrow(invalid);
    expect(() =>
      service.geojson({ operation: "to_feature_collection", toleranceKm: 0.05 }),
    ).toThrow(invalid);
    expect(() =>
      service.geojson({ operation: "simplify", geojson: "nope", toleranceKm: 0.05 }),
    ).toThrow(invalid);
    expect(() =>
      service.geojson({
        operation: "simplify",
        geojson: { type: "Point", coordinates: "banana" },
        toleranceKm: 0.05,
      }),
    ).toThrow(/Invalid GeoJSON/);
    expect(() => service.check({ operation: "bounding_box", points: [] })).toThrow(invalid);
  });
});
