import type { Coord } from "../../src/domain/types.js";

export const nullIsland: Coord = { lat: 0, lng: 0 };
export const nyc: Coord = { lat: 40.7128, lng: -74.006 };
export const london: Coord = { lat: 51.5074, lng: -0.1278 };
export const tokyo: Coord = { lat: 35.6895, lng: 139.6917 };
export const westOfDateLine: Coord = { lat: 0, lng: 179.8 };
export const eastOfDateLine: Coord = { lat: 0, lng: -179.8 };

export const unitSquare: readonly Coord[] = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 1 },
  { lat: 1, lng: 1 },
  { lat: 1, lng: 0 },
];

export const sampleLineString = {
  type: "LineString",
  coordinates: [
    [0, 0],
    [0.001, 0],
    [1, 0],
  ],
};
