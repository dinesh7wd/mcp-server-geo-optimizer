import { describe, expect, it } from "vitest";
import {
  boundingBox,
  convexHull,
  lngWindow,
  pointInPolygon,
  pointsToFeatureCollection,
  simplifyGeoJson,
  simplifyPath,
  validateGeoJson,
} from "../../../src/domain/geometry.js";
import { DomainError } from "../../../src/utils/errors.js";
import {
  eastOfDateLine,
  sampleLineString,
  unitSquare,
  westOfDateLine,
} from "../../fixtures/coords.js";

const dateLineSquare = [
  { lat: -5, lng: 170 },
  { lat: -5, lng: -170 },
  { lat: 5, lng: -170 },
  { lat: 5, lng: 170 },
];

describe("pointInPolygon", () => {
  it("detects points inside and outside a polygon", () => {
    expect(pointInPolygon({ lat: 0.5, lng: 0.5 }, unitSquare)).toBe(true);
    expect(pointInPolygon({ lat: 2, lng: 2 }, unitSquare)).toBe(false);
    expect(pointInPolygon({ lat: 0.5, lng: -0.5 }, unitSquare)).toBe(false);
  });

  it("handles polygons that cross the antimeridian", () => {
    expect(pointInPolygon({ lat: 0, lng: 179 }, dateLineSquare)).toBe(true);
    expect(pointInPolygon({ lat: 0, lng: -179 }, dateLineSquare)).toBe(true);
    expect(pointInPolygon({ lat: 0, lng: 0 }, dateLineSquare)).toBe(false);
    expect(pointInPolygon({ lat: 0, lng: 160 }, dateLineSquare)).toBe(false);
  });

  it("rejects degenerate polygons", () => {
    expect(() =>
      pointInPolygon({ lat: 0, lng: 0 }, [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ]),
    ).toThrow(DomainError);
  });
});

describe("convexHull", () => {
  it("returns exactly the square corners and drops interior points", () => {
    const hull = convexHull([...unitSquare, { lat: 0.5, lng: 0.5 }, { lat: 0, lng: 0 }]);
    expect(hull).toHaveLength(4);
    expect(hull).toEqual(expect.arrayContaining([...unitSquare]));
    expect(hull).not.toContainEqual({ lat: 0.5, lng: 0.5 });
  });

  it("builds a correct hull across the antimeridian", () => {
    const hull = convexHull([...dateLineSquare, { lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 }]);
    expect(hull).toHaveLength(4);
    expect(hull).toEqual(expect.arrayContaining(dateLineSquare));
  });

  it("handles empty, single and collinear inputs", () => {
    expect(convexHull([])).toEqual([]);
    expect(convexHull([{ lat: 1, lng: 1 }])).toEqual([{ lat: 1, lng: 1 }]);
    expect(
      convexHull([
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
        { lat: 0, lng: 2 },
      ]),
    ).toEqual([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
    ]);
  });
});

describe("boundingBox", () => {
  it("returns minLng > maxLng for boxes crossing the antimeridian", () => {
    expect(boundingBox([westOfDateLine, eastOfDateLine])).toEqual({
      minLat: 0,
      maxLat: 0,
      minLng: 179.8,
      maxLng: -179.8,
      crossesAntimeridian: true,
    });
  });

  it("uses the largest longitude gap, not the raw span", () => {
    const box = boundingBox([
      { lat: 0, lng: -100 },
      { lat: 1, lng: 0 },
      { lat: 2, lng: 100 },
    ]);
    expect(box).toEqual({
      minLat: 0,
      maxLat: 2,
      minLng: -100,
      maxLng: 100,
      crossesAntimeridian: false,
    });
  });

  it("rejects empty input", () => {
    expect(() => boundingBox([])).toThrow(DomainError);
    expect(() => lngWindow([])).toThrow(DomainError);
  });

  it("computes longitude windows", () => {
    expect(lngWindow([10])).toEqual({ west: 10, east: 10, crosses: false });
    expect(lngWindow([170, -170, 175])).toEqual({ west: 170, east: -170, crosses: true });
  });
});

describe("simplifyPath", () => {
  it("drops nearly collinear points and keeps significant ones", () => {
    const line = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
      { lat: 0, lng: 1 },
    ];
    expect(simplifyPath(line, 1)).toEqual([line[0], line[2]]);
    const corner = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0.5 },
      { lat: 0, lng: 1 },
    ];
    expect(simplifyPath(corner, 1)).toEqual(corner);
    expect(simplifyPath(corner.slice(0, 2), 1)).toHaveLength(2);
  });

  it("handles long inputs without recursion limits", { timeout: 30_000 }, () => {
    const line = Array.from({ length: 12_000 }, (_, i) => ({
      lat: Math.sin(i) * 0.01,
      lng: i * 0.001,
    }));
    expect(simplifyPath(line, 0).length).toBeGreaterThan(6_000);
  });
});

describe("validateGeoJson", () => {
  it("accepts valid geometries, features and collections", () => {
    const valid = [
      { type: "Point", coordinates: [0, 0, 12] },
      sampleLineString,
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        ],
      },
      { type: "MultiPoint", coordinates: [] },
      { type: "Feature", geometry: null, properties: null },
      { type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [1, 2] }] },
      {
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: sampleLineString, properties: {} }],
      },
    ];
    for (const value of valid) {
      expect(validateGeoJson(value)).toEqual({ valid: true, errors: [] });
    }
  });

  it("rejects non-array coordinates", () => {
    const result = validateGeoJson({ type: "Point", coordinates: "banana" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/^geometry.coordinates: position must be/);
  });

  it("rejects out-of-range coordinates", () => {
    const result = validateGeoJson({
      type: "Polygon",
      coordinates: [
        [
          [0, 999],
          [1, 0],
          [0, 1],
          [0, 999],
        ],
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("geometry.coordinates[0][0]: latitude 999 is outside -90..90");
    expect(validateGeoJson({ type: "Point", coordinates: [200, 0] }).errors[0]).toMatch(
      /longitude 200/,
    );
  });

  it("rejects invalid features inside collections", () => {
    const result = validateGeoJson({ type: "FeatureCollection", features: [1] });
    expect(result).toEqual({ valid: false, errors: ["features[0]: must be a GeoJSON Feature"] });
  });

  it("reports structural problems", () => {
    expect(validateGeoJson("nope").valid).toBe(false);
    expect(validateGeoJson({ type: "Nope" }).errors[0]).toMatch(/invalid geometry type "Nope"/);
    expect(validateGeoJson({ type: "FeatureCollection" }).errors[0]).toBe(
      "features: must be an array",
    );
    expect(validateGeoJson({ type: "Feature" }).errors[0]).toMatch(/geometry: is required/);
    expect(validateGeoJson({ type: "Polygon" }).errors[0]).toBe(
      "geometry.coordinates: must be an array",
    );
    expect(validateGeoJson({ type: "LineString", coordinates: [[0, 0]] }).errors[0]).toMatch(
      /at least 2/,
    );
    expect(
      validateGeoJson({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      }).errors[0],
    ).toMatch(/must be closed/);
    expect(
      validateGeoJson({
        type: "Feature",
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: 3,
      }).errors[0],
    ).toBe("feature.properties: must be an object or null");
    expect(validateGeoJson({ type: "GeometryCollection", geometries: [42] }).errors[0]).toMatch(
      /geometry object/,
    );
  });

  it("limits nesting depth and error count", () => {
    let nested: Record<string, unknown> = { type: "Point", coordinates: [0, 0] };
    for (let i = 0; i < 40; i += 1) {
      nested = { type: "GeometryCollection", geometries: [nested] };
    }
    expect(validateGeoJson(nested).errors[0]).toMatch(/nesting deeper than 32/);
    const many = { type: "MultiPoint", coordinates: Array.from({ length: 50 }, () => "x") };
    expect(validateGeoJson(many).errors).toHaveLength(20);
  });
});

describe("simplifyGeoJson", () => {
  it("preserves altitude when simplifying a LineString", () => {
    const result = simplifyGeoJson(
      {
        type: "LineString",
        coordinates: [
          [0, 0, 100],
          [0.0001, 0, 150],
          [1, 0, 200],
        ],
      },
      1,
    );
    expect(result.coordinates).toEqual([
      [0, 0, 100],
      [1, 0, 200],
    ]);
  });

  it("simplifies MultiLineStrings, polygon rings and nested collections", () => {
    const line = [
      [0, 0],
      [0.0001, 0],
      [1, 0],
    ];
    const ring = [
      [0, 0],
      [0.5, 0.00001],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    const collection = simplifyGeoJson(
      {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "MultiLineString", coordinates: [line] } },
          { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } },
          { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [[ring]] } },
          {
            type: "Feature",
            geometry: {
              type: "GeometryCollection",
              geometries: [{ type: "LineString", coordinates: line }],
            },
          },
        ],
      },
      1,
    );
    const geometries = (collection.features as { geometry: Record<string, unknown> }[]).map(
      (f) => f.geometry,
    );
    expect(geometries[0]?.coordinates).toEqual([
      [
        [0, 0],
        [1, 0],
      ],
    ]);
    expect(geometries[1]?.coordinates).toEqual([
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ]);
    expect(geometries[2]?.coordinates).toEqual([
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    ]);
    expect((geometries[3]?.geometries as { coordinates: unknown }[])[0]?.coordinates).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("keeps rings that would collapse and leaves points untouched", () => {
    const tiny = [
      [0, 0],
      [0.00001, 0],
      [0.00001, 0.00001],
      [0, 0],
    ];
    expect(simplifyGeoJson({ type: "Polygon", coordinates: [tiny] }, 1).coordinates).toEqual([
      tiny,
    ]);
    const point = { type: "Point", coordinates: [1, 2] };
    expect(simplifyGeoJson(point, 1)).toEqual(point);
    expect(simplifyGeoJson({ type: "LineString", coordinates: "bad" }, 1).coordinates).toBe("bad");
    expect(simplifyGeoJson({ type: "Feature", geometry: null }, 1).geometry).toBeNull();
  });
});

describe("pointsToFeatureCollection", () => {
  it("emits [lng, lat] coordinates and ids", () => {
    expect(
      pointsToFeatureCollection([
        { lat: 1, lng: 2, id: "p1" },
        { lat: 3, lng: 4 },
      ]),
    ).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "p1",
          properties: { id: "p1" },
          geometry: { type: "Point", coordinates: [2, 1] },
        },
        {
          type: "Feature",
          id: 1,
          properties: {},
          geometry: { type: "Point", coordinates: [4, 3] },
        },
      ],
    });
  });
});
