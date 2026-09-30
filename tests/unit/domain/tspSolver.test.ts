import { describe, expect, it } from "vitest";
import {
  distanceMatrixFromCoords,
  solveTsp,
  solveVrp,
  type Matrix,
  type VrpOptions,
} from "../../../src/domain/tspSolver.js";
import type { Waypoint } from "../../../src/domain/types.js";
import { DomainError } from "../../../src/utils/errors.js";
import { seededRandom } from "../../helpers.js";
import { unitSquare } from "../../fixtures/coords.js";

const baseOptions: VrpOptions = {
  vehicleCount: 1,
  capacity: undefined,
  closed: true,
  startIndex: 0,
  averageSpeedKmh: 40,
};

function vrp(
  points: readonly Waypoint[],
  options: Partial<VrpOptions> = {},
): ReturnType<typeof solveVrp> {
  return solveVrp(
    points,
    { distancesKm: distanceMatrixFromCoords(points) },
    { ...baseOptions, ...options },
  );
}

function tourLength(order: readonly number[], matrix: Matrix, closed: boolean): number {
  let total = 0;
  for (let i = 1; i < order.length; i += 1) {
    total += matrix[order[i - 1] ?? 0]?.[order[i] ?? 0] ?? 0;
  }
  return closed ? total + (matrix[order[order.length - 1] ?? 0]?.[order[0] ?? 0] ?? 0) : total;
}

function bruteForce(matrix: Matrix, closed: boolean): number {
  const rest = matrix.map((_, i) => i).slice(1);
  let best = Infinity;
  const visit = (prefix: number[], remaining: number[]): void => {
    if (remaining.length === 0) {
      best = Math.min(best, tourLength([0, ...prefix], matrix, closed));
      return;
    }
    remaining.forEach((node, i) =>
      visit(
        [...prefix, node],
        remaining.filter((_, j) => j !== i),
      ),
    );
  };
  visit([], rest);
  return best;
}

function randomPoints(n: number, seed: number): Waypoint[] {
  const rand = seededRandom(seed);
  return Array.from({ length: n }, () => ({ lat: rand() * 2, lng: rand() * 2 }));
}

describe("solveTsp", () => {
  it("solves a closed square tour along the perimeter", () => {
    const matrix = distanceMatrixFromCoords(unitSquare);
    const result = solveTsp(matrix, { closed: true, startIndex: 0 });
    expect(result.order[0]).toBe(0);
    expect([...result.order].sort()).toEqual([0, 1, 2, 3]);
    expect(result.distanceKm).toBeCloseTo(tourLength([0, 1, 2, 3], matrix, true), 6);
  });

  it("matches brute force for n <= 7 (open and closed)", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const n = 4 + (seed % 4);
      const matrix = distanceMatrixFromCoords(randomPoints(n, seed));
      for (const closed of [true, false]) {
        expect(solveTsp(matrix, { closed, startIndex: 0 }).distanceKm).toBeCloseTo(
          bruteForce(matrix, closed),
          6,
        );
      }
    }
  });

  it("keeps the 2-opt heuristic within 5% of brute force for n = 7", () => {
    for (let seed = 20; seed < 32; seed += 1) {
      const matrix = distanceMatrixFromCoords(randomPoints(7, seed));
      for (const closed of [true, false]) {
        const heuristic = solveTsp(matrix, { closed, startIndex: 0, exactMaxSize: 0 }).distanceKm;
        expect(heuristic).toBeLessThanOrEqual(bruteForce(matrix, closed) * 1.05 + 1e-9);
      }
    }
  });

  it("returns a valid permutation from a non-zero start on larger inputs", () => {
    const matrix = distanceMatrixFromCoords(randomPoints(40, 99));
    const result = solveTsp(matrix, { closed: false, startIndex: 7 });
    expect(result.order[0]).toBe(7);
    expect([...result.order].sort((x, y) => x - y)).toEqual(matrix.map((_, i) => i));
    expect(result.distanceKm).toBeCloseTo(tourLength(result.order, matrix, false), 6);
  });

  it("handles trivial and invalid inputs", () => {
    expect(solveTsp([[0]], { closed: true, startIndex: 0 })).toEqual({ order: [0], distanceKm: 0 });
    expect(() => solveTsp([], { closed: true, startIndex: 0 })).toThrow(DomainError);
    expect(() => solveTsp([[0]], { closed: true, startIndex: 1 })).toThrow(DomainError);
  });
});

describe("solveVrp: vehicles and capacity", () => {
  const star = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 0, lng: -1 },
    { lat: 1, lng: 0 },
    { lat: -1, lng: 0 },
  ];

  it("uses every vehicle when there is no capacity limit", () => {
    const result = vrp(star, { vehicleCount: 3 });
    expect(result.routes).toHaveLength(3);
    const served = result.routes.flatMap((r) => r.stops.slice(1).map((s) => s.index)).sort();
    expect(served).toEqual([1, 2, 3, 4]);
    expect(result.routes.every((r) => r.stops[0]?.index === 0)).toBe(true);
    expect(result.feasible).toBe(true);
  });

  it("never uses more vehicles than stops", () => {
    expect(vrp(star.slice(0, 3), { vehicleCount: 5 }).routes).toHaveLength(2);
  });

  it("splits demand across vehicles within capacity", () => {
    const points = [
      { lat: 0, lng: 0, demand: 5 },
      { lat: 0, lng: 0.1, demand: 3 },
      { lat: 0, lng: 0.2, demand: 3 },
      { lat: 0.1, lng: 0, demand: 3 },
    ];
    const result = vrp(points, { vehicleCount: 2, capacity: 6 });
    expect(result.routes).toHaveLength(2);
    expect(result.unassigned).toEqual([]);
    expect(result.routes.map((r) => r.demand).sort()).toEqual([3, 6]);
  });

  it("reports stops that cannot fit instead of dropping them silently", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.1, demand: 10 },
      { lat: 0, lng: 0.2, demand: 4 },
      { lat: 0.1, lng: 0, demand: 4 },
    ];
    const result = vrp(points, { vehicleCount: 1, capacity: 5 });
    expect(result.unassigned).toHaveLength(2);
    expect(result.unassigned).toContain(1);
    expect(result.feasible).toBe(false);
    expect(result.routes[0]?.demand).toBe(4);
  });

  it("places overflow stops into vehicles with spare capacity", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.1, demand: 4 },
      { lat: 0.1, lng: 0.1, demand: 4 },
      { lat: 0.1, lng: 0, demand: 1 },
    ];
    const result = vrp(points, { vehicleCount: 2, capacity: 5 });
    expect(result.unassigned).toEqual([]);
    expect(result.routes.every((r) => r.demand <= 5)).toBe(true);
  });
});

describe("solveVrp: costs and time windows", () => {
  it("uses the supplied distance and duration matrices", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.1 },
    ];
    const result = solveVrp(
      points,
      {
        distancesKm: [
          [0, 50],
          [50, 0],
        ],
        durationsMin: [
          [0, 70],
          [70, 0],
        ],
      },
      { ...baseOptions, closed: false },
    );
    expect(result.totalDistanceKm).toBe(50);
    expect(result.totalDurationMin).toBe(70);
    expect(result.routes[0]?.stops[1]?.arrivalMin).toBe(70);
  });

  it("derives durations from averageSpeedKmh without a duration matrix", () => {
    const result = solveVrp(
      [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.1 },
      ],
      {
        distancesKm: [
          [0, 20],
          [20, 0],
        ],
      },
      { ...baseOptions, closed: true, averageSpeedKmh: 40 },
    );
    expect(result.totalDistanceKm).toBe(40);
    expect(result.totalDurationMin).toBe(60);
  });

  it("finds the feasible order when the nearest stop opens late", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01, readyTimeMin: 60, id: "late-open" },
      { lat: 0, lng: 0.1, dueTimeMin: 20, id: "urgent" },
    ];
    const result = vrp(points, { closed: false });
    expect(result.routes[0]?.stops.map((s) => s.index)).toEqual([0, 2, 1]);
    expect(result.feasible).toBe(true);
    expect(result.routes[0]?.stops[2]).toMatchObject({ id: "late-open", departureMin: 60 });
    expect(result.routes[0]?.stops[2]?.waitMin).toBeGreaterThan(0);
  });

  it("repairs time windows on routes too large for exact search", () => {
    const west = Array.from({ length: 5 }, (_, i): Waypoint => ({ lat: 0, lng: -0.01 * (i + 1) }));
    const east = Array.from({ length: 23 }, (_, i): Waypoint => ({ lat: 0, lng: 0.01 * (i + 1) }));
    const points: Waypoint[] = [{ lat: 0, lng: 0 }, ...west, ...east, { lat: 0, lng: 0.25 }];
    const arrivalAtUrgent = (result: ReturnType<typeof vrp>): number | undefined =>
      result.routes[0]?.stops.find((s) => s.index === 29)?.arrivalMin;
    expect(arrivalAtUrgent(vrp(points, { closed: false }))).toBeGreaterThan(45);
    points[29] = { lat: 0, lng: 0.25, dueTimeMin: 45 };
    const result = vrp(points, { closed: false });
    expect(result.feasible).toBe(true);
    expect(arrivalAtUrgent(result)).toBeLessThanOrEqual(45);
  });

  it("reports violations instead of throwing when windows are infeasible", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 10, dueTimeMin: 1, id: "far" },
    ];
    const result = vrp(points, { closed: false });
    expect(result.feasible).toBe(false);
    expect(result.routes[0]?.violations).toEqual([
      expect.objectContaining({ index: 1, dueTimeMin: 1 }),
    ]);
    expect(result.routes[0]?.stops[1]?.lateMin).toBeGreaterThan(0);
  });

  it("checks the depot due time on the return leg of closed routes", () => {
    const points = [
      { lat: 0, lng: 0, dueTimeMin: 10 },
      { lat: 0, lng: 0.2 },
    ];
    const result = vrp(points, { closed: true });
    expect(result.routes[0]?.violations[0]).toMatchObject({ index: 0, returnToDepot: true });
  });

  it("rejects readyTimeMin > dueTimeMin and mismatched matrices", () => {
    expect(() =>
      vrp([
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1, readyTimeMin: 10, dueTimeMin: 5 },
      ]),
    ).toThrow(/readyTimeMin greater than dueTimeMin/);
    expect(() =>
      solveVrp(
        [
          { lat: 0, lng: 0 },
          { lat: 0, lng: 1 },
        ],
        { distancesKm: [[0]] },
        baseOptions,
      ),
    ).toThrow(/dimensions/);
    expect(() => vrp([{ lat: 0, lng: 0 }])).toThrow(DomainError);
    expect(() =>
      vrp(
        [
          { lat: 0, lng: 0 },
          { lat: 0, lng: 1 },
        ],
        { startIndex: 5 },
      ),
    ).toThrow(/out of range/);
  });

  it("returns stop ids but not echoed points", () => {
    const result = vrp([
      { lat: 0, lng: 0, id: "depot" },
      { lat: 0, lng: 0.1 },
    ]);
    expect(result.routes[0]?.stops[0]).toEqual({
      index: 0,
      id: "depot",
      arrivalMin: 0,
      waitMin: 0,
      departureMin: 0,
    });
    expect(result.routes[0]?.stops[1]).not.toHaveProperty("point");
    expect(result.routes[0]?.stops[1]).not.toHaveProperty("id");
  });
});
