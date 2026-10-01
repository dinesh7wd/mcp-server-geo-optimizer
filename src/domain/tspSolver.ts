import type {
  Coord,
  Route,
  RouteStop,
  TimeWindowViolation,
  TspResult,
  VrpResult,
  Waypoint,
} from "./types.js";
import { DomainError } from "../utils/errors.js";
import { requireIndex } from "../utils/validators.js";
import { durationMin, haversineKm, shortestLngDelta } from "./haversine.js";

export type Matrix = readonly (readonly number[])[];

export interface TspOptions {
  readonly closed: boolean;
  readonly startIndex: number;
  readonly exactMaxSize?: number | undefined;
  readonly timeBudgetMs?: number | undefined;
}

export interface VrpOptions {
  readonly vehicleCount: number;
  readonly capacity: number | undefined;
  readonly closed: boolean;
  readonly startIndex: number;
  readonly averageSpeedKmh: number;
  readonly exactMaxSize?: number | undefined;
  /** Wall-clock limit for local search across all vehicles; the best route found so far is kept. */
  readonly timeBudgetMs?: number | undefined;
}

export interface CostMatrices {
  readonly distancesKm: Matrix;
  readonly durationsMin?: Matrix | undefined;
}

interface Evaluation {
  readonly distanceKm: number;
  readonly latenessMin: number;
}

interface Schedule extends Evaluation {
  readonly durationMin: number;
  readonly stops: RouteStop[];
  readonly violations: TimeWindowViolation[];
}

interface Legs {
  readonly km: Distance;
  readonly min: Distance;
}

interface RouteContext {
  readonly points: readonly Waypoint[];
  readonly legs: Legs;
  readonly closed: boolean;
}

interface Step {
  readonly tour: number[];
  readonly evaluation: Evaluation;
}

interface Budget {
  remaining: number;
  readonly deadline: number;
}

type Evaluate = (order: readonly number[]) => Evaluation;
type Distance = (from: number, to: number) => number;

export const DEFAULT_EXACT_MAX_SIZE = 8;
const MAX_IMPROVEMENT_PASSES = 1000;
const SCHEDULE_EVALUATION_BUDGET = 40_000_000;
export const DEFAULT_SEARCH_TIME_BUDGET_MS = 1500;
const CLOCK_CHECK_INTERVAL = 64;
const EPSILON = 1e-9;

function spend(budget: Budget): void {
  budget.remaining -= 1;
  if (budget.remaining % CLOCK_CHECK_INTERVAL === 0 && performance.now() >= budget.deadline) {
    budget.remaining = 0;
  }
}

function matrixAt(matrix: Matrix, i: number, j: number): number {
  return requireIndex(requireIndex(matrix, i, "matrix row"), j, "matrix col");
}

function isBetter(a: Evaluation, b: Evaluation): boolean {
  if (Math.abs(a.latenessMin - b.latenessMin) > EPSILON) {
    return a.latenessMin < b.latenessMin;
  }
  return a.distanceKm < b.distanceKm - EPSILON;
}

function pathDistance(order: readonly number[], distance: Distance, closed: boolean): number {
  let total = 0;
  for (let i = 1; i < order.length; i += 1) {
    total += distance(requireIndex(order, i - 1, "tour"), requireIndex(order, i, "tour"));
  }
  if (closed && order.length > 1) {
    total += distance(
      requireIndex(order, order.length - 1, "tour"),
      requireIndex(order, 0, "tour"),
    );
  }
  return total;
}

function nearestNeighbor(n: number, distance: Distance, startIndex: number): number[] {
  const unused = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    if (i !== startIndex) {
      unused.add(i);
    }
  }
  const order = [startIndex];
  let current = startIndex;
  while (unused.size > 0) {
    let best = -1;
    let bestDist = Infinity;
    for (const candidate of unused) {
      const dist = distance(current, candidate);
      if (best === -1 || dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    unused.delete(best);
    order.push(best);
    current = best;
  }
  return order;
}

function permute(items: number[], k: number, visit: (items: readonly number[]) => void): void {
  if (k >= items.length - 1) {
    visit(items);
    return;
  }
  for (let i = k; i < items.length; i += 1) {
    [items[k], items[i]] = [items[i] as number, items[k] as number];
    permute(items, k + 1, visit);
    [items[k], items[i]] = [items[i] as number, items[k] as number];
  }
}

function exactOrder(n: number, startIndex: number, evaluate: Evaluate): number[] {
  const rest: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (i !== startIndex) {
      rest.push(i);
    }
  }
  let best = [startIndex, ...rest];
  let bestEval = evaluate(best);
  permute(rest, 0, (perm) => {
    const order = [startIndex, ...perm];
    const evaluation = evaluate(order);
    if (isBetter(evaluation, bestEval)) {
      best = order;
      bestEval = evaluation;
    }
  });
  return best;
}

function successor(tour: readonly number[], position: number, closed: boolean): number | undefined {
  if (position + 1 < tour.length) {
    return tour[position + 1];
  }
  return closed ? tour[0] : undefined;
}

function reverseRange(tour: number[], from: number, to: number): void {
  for (let i = from, j = to; i < j; i += 1, j -= 1) {
    [tour[i], tour[j]] = [tour[j] as number, tour[i] as number];
  }
}

function twoOptDistance(tour: number[], distance: Distance, closed: boolean): boolean {
  const link = (from: number, to: number | undefined): number =>
    to === undefined ? 0 : distance(from, to);
  let improved = false;
  for (let i = 1; i < tour.length - 1; i += 1) {
    const before = requireIndex(tour, i - 1, "tour");
    let forward = 0;
    let reverse = 0;
    for (let k = i + 1; k < tour.length; k += 1) {
      const prev = requireIndex(tour, k - 1, "tour");
      const last = requireIndex(tour, k, "tour");
      forward += distance(prev, last);
      reverse += distance(last, prev);
      const first = requireIndex(tour, i, "tour");
      const after = successor(tour, k, closed);
      const current = distance(before, first) + forward + link(last, after);
      const candidate = distance(before, last) + reverse + link(first, after);
      if (candidate < current - EPSILON) {
        reverseRange(tour, i, k);
        [forward, reverse] = [reverse, forward];
        improved = true;
      }
    }
  }
  return improved;
}

function moveSegment(
  tour: number[],
  i: number,
  length: number,
  distance: Distance,
  closed: boolean,
): boolean {
  const link = (from: number, to: number | undefined): number =>
    to === undefined ? 0 : distance(from, to);
  const end = i + length - 1;
  const prev = requireIndex(tour, i - 1, "tour");
  const head = requireIndex(tour, i, "tour");
  const tail = requireIndex(tour, end, "tour");
  const next = successor(tour, end, closed);
  const gain = distance(prev, head) + link(tail, next) - link(prev, next);
  for (let j = 0; j < tour.length; j += 1) {
    if (j >= i - 1 && j <= end) {
      continue;
    }
    const a = requireIndex(tour, j, "tour");
    const b = successor(tour, j, closed);
    if (distance(a, head) + link(tail, b) - link(a, b) < gain - EPSILON) {
      const segment = tour.splice(i, length);
      tour.splice(tour.indexOf(a) + 1, 0, ...segment);
      return true;
    }
  }
  return false;
}

function orOptDistance(tour: number[], distance: Distance, closed: boolean): boolean {
  let improved = false;
  for (let length = 1; length <= 3; length += 1) {
    for (let i = 1; i + length <= tour.length; i += 1) {
      improved = moveSegment(tour, i, length, distance, closed) || improved;
    }
  }
  if (!closed) {
    for (let i = 1; i < tour.length - 3; i += 1) {
      improved = moveSegment(tour, i, tour.length - i, distance, closed) || improved;
    }
  }
  return improved;
}

function optimizeDistance(
  tour: number[],
  distance: Distance,
  closed: boolean,
  deadline: number,
): number[] {
  for (let pass = 0; pass < MAX_IMPROVEMENT_PASSES && performance.now() < deadline; pass += 1) {
    const reversed = twoOptDistance(tour, distance, closed);
    const moved = orOptDistance(tour, distance, closed);
    if (!reversed && !moved) {
      break;
    }
  }
  return tour;
}

function twoOptPass(
  tour: number[],
  current: Evaluation,
  evaluate: Evaluate,
  budget: Budget,
): Step | undefined {
  let bestTour = tour;
  let bestEval = current;
  for (let i = 1; i < bestTour.length - 1 && budget.remaining > 0; i += 1) {
    for (let k = i + 1; k < bestTour.length && budget.remaining > 0; k += 1) {
      const candidate = bestTour
        .slice(0, i)
        .concat(bestTour.slice(i, k + 1).reverse(), bestTour.slice(k + 1));
      const evaluation = evaluate(candidate);
      spend(budget);
      if (isBetter(evaluation, bestEval)) {
        bestTour = candidate;
        bestEval = evaluation;
      }
    }
  }
  return bestTour === tour ? undefined : { tour: bestTour, evaluation: bestEval };
}

function relocatePass(
  tour: number[],
  current: Evaluation,
  evaluate: Evaluate,
  budget: Budget,
): Step | undefined {
  for (let i = 1; i < tour.length && budget.remaining > 0; i += 1) {
    const node = requireIndex(tour, i, "tour");
    const without = tour.slice(0, i).concat(tour.slice(i + 1));
    for (let j = 1; j <= without.length && budget.remaining > 0; j += 1) {
      if (j === i) {
        continue;
      }
      const candidate = without.slice(0, j).concat([node], without.slice(j));
      const evaluation = evaluate(candidate);
      spend(budget);
      if (isBetter(evaluation, current)) {
        return { tour: candidate, evaluation };
      }
    }
  }
  return undefined;
}

function improve(initial: number[], evaluate: Evaluate, budget: Budget): number[] {
  let tour = initial;
  let current = evaluate(tour);
  for (let pass = 0; pass < MAX_IMPROVEMENT_PASSES && budget.remaining > 0; pass += 1) {
    const step =
      twoOptPass(tour, current, evaluate, budget) ?? relocatePass(tour, current, evaluate, budget);
    if (step === undefined) {
      break;
    }
    tour = step.tour;
    current = step.evaluation;
  }
  return tour;
}

function searchOrder(
  n: number,
  startIndex: number,
  distance: Distance,
  closed: boolean,
  scheduleEvaluate: Evaluate | undefined,
  exactMaxSize: number,
  deadline: number,
): number[] {
  if (n <= exactMaxSize) {
    const distanceOnly: Evaluate = (order) => ({
      distanceKm: pathDistance(order, distance, closed),
      latenessMin: 0,
    });
    return exactOrder(n, startIndex, scheduleEvaluate ?? distanceOnly);
  }
  const tour = optimizeDistance(
    nearestNeighbor(n, distance, startIndex),
    distance,
    closed,
    deadline,
  );
  if (scheduleEvaluate === undefined || scheduleEvaluate(tour).latenessMin <= EPSILON) {
    return tour;
  }
  const budget: Budget = {
    remaining: Math.max(20_000, Math.floor(SCHEDULE_EVALUATION_BUDGET / n)),
    deadline,
  };
  return improve(tour, scheduleEvaluate, budget);
}

export function solveTsp(matrix: Matrix, options: TspOptions): TspResult {
  const n = matrix.length;
  if (n === 0) {
    throw new DomainError("EMPTY", "TSP requires at least one point");
  }
  if (options.startIndex < 0 || options.startIndex >= n) {
    throw new DomainError("OUT_OF_RANGE", "startIndex is out of range");
  }
  if (n === 1) {
    return { order: [0], distanceKm: 0 };
  }
  const distance: Distance = (i, j) => matrixAt(matrix, i, j);
  const exactMaxSize = options.exactMaxSize ?? DEFAULT_EXACT_MAX_SIZE;
  const order = searchOrder(
    n,
    options.startIndex,
    distance,
    options.closed,
    undefined,
    exactMaxSize,
    performance.now() + (options.timeBudgetMs ?? DEFAULT_SEARCH_TIME_BUDGET_MS),
  );
  return { order, distanceKm: pathDistance(order, distance, options.closed) };
}

function waypointDemand(point: Waypoint): number {
  return point.demand ?? 0;
}

function lateness(arrivalMin: number, dueTimeMin: number | undefined): number {
  return dueTimeMin === undefined ? 0 : Math.max(0, arrivalMin - dueTimeMin);
}

function legCosts(matrices: CostMatrices, speedKmh: number): Legs {
  const { distancesKm, durationsMin } = matrices;
  const km: Distance = (i, j) => matrixAt(distancesKm, i, j);
  const min: Distance =
    durationsMin === undefined
      ? (i, j): number => durationMin(km(i, j), speedKmh)
      : (i, j): number => matrixAt(durationsMin, i, j);
  return { km, min };
}

function makeStop(
  index: number,
  point: Waypoint,
  arrivalMin: number,
  waitMin: number,
  departureMin: number,
  lateMin: number,
): RouteStop {
  return {
    index,
    ...(point.id === undefined ? {} : { id: point.id }),
    arrivalMin,
    waitMin,
    departureMin,
    ...(lateMin > 0 ? { lateMin } : {}),
  };
}

function makeViolation(
  index: number,
  arrivalMin: number,
  dueTimeMin: number | undefined,
  lateMin: number,
  returnToDepot: boolean,
): TimeWindowViolation {
  return {
    index,
    arrivalMin,
    dueTimeMin: dueTimeMin ?? 0,
    lateMin,
    ...(returnToDepot ? { returnToDepot: true } : {}),
  };
}

function simulate(order: readonly number[], ctx: RouteContext, collect: boolean): Schedule {
  const stops: RouteStop[] = [];
  const violations: TimeWindowViolation[] = [];
  let elapsed = 0;
  let distanceKm = 0;
  let latenessMin = 0;
  order.forEach((index, i) => {
    const point = requireIndex(ctx.points, index, "waypoint");
    if (i > 0) {
      const prev = requireIndex(order, i - 1, "order");
      distanceKm += ctx.legs.km(prev, index);
      elapsed += ctx.legs.min(prev, index);
    }
    const arrivalMin = elapsed;
    const waitMin = Math.max(0, (point.readyTimeMin ?? 0) - arrivalMin);
    const lateMin = i === 0 ? 0 : lateness(arrivalMin, point.dueTimeMin);
    elapsed += waitMin + (point.serviceTimeMin ?? 0);
    latenessMin += lateMin;
    if (collect) {
      stops.push(makeStop(index, point, arrivalMin, waitMin, elapsed, lateMin));
      if (lateMin > 0) {
        violations.push(makeViolation(index, arrivalMin, point.dueTimeMin, lateMin, false));
      }
    }
  });
  if (ctx.closed && order.length > 1) {
    const first = requireIndex(order, 0, "order");
    const last = requireIndex(order, order.length - 1, "order");
    distanceKm += ctx.legs.km(last, first);
    elapsed += ctx.legs.min(last, first);
    const depotDue = requireIndex(ctx.points, first, "waypoint").dueTimeMin;
    const lateMin = lateness(elapsed, depotDue);
    latenessMin += lateMin;
    if (collect && lateMin > 0) {
      violations.push(makeViolation(first, elapsed, depotDue, lateMin, true));
    }
  }
  return { distanceKm, latenessMin, durationMin: elapsed, stops, violations };
}

function sweepOrder(points: readonly Waypoint[], depot: number): number[] {
  const origin: Coord = requireIndex(points, depot, "waypoint");
  const scale = Math.cos((origin.lat * Math.PI) / 180);
  const entries = points
    .flatMap((p, index) =>
      index === depot
        ? []
        : [
            {
              index,
              angle: Math.atan2(p.lat - origin.lat, shortestLngDelta(origin.lng, p.lng) * scale),
            },
          ],
    )
    .sort((a, b) => a.angle - b.angle || a.index - b.index);
  let start = 0;
  let widest = -Infinity;
  entries.forEach((entry, i) => {
    const prev =
      i === 0
        ? requireIndex(entries, entries.length - 1, "entry").angle - 2 * Math.PI
        : requireIndex(entries, i - 1, "entry").angle;
    if (entry.angle - prev > widest + EPSILON) {
      widest = entry.angle - prev;
      start = i;
    }
  });
  return entries
    .slice(start)
    .concat(entries.slice(0, start))
    .map((entry) => entry.index);
}

function assignVehicles(
  points: readonly Waypoint[],
  options: VrpOptions,
): { groups: number[][]; unassigned: number[] } {
  const order = sweepOrder(points, options.startIndex);
  const base = Math.floor(order.length / options.vehicleCount);
  const extra = order.length % options.vehicleCount;
  const target = (v: number): number => base + (v < extra ? 1 : 0);
  const stops: number[][] = Array.from({ length: options.vehicleCount }, () => []);
  const loads = new Array<number>(options.vehicleCount).fill(0);
  const fits = (v: number, demand: number): boolean =>
    options.capacity === undefined || requireIndex(loads, v, "load") + demand <= options.capacity;
  const place = (v: number, idx: number, demand: number): void => {
    requireIndex(stops, v, "vehicle").push(idx);
    loads[v] = requireIndex(loads, v, "load") + demand;
  };
  const overflow: number[] = [];
  const unassigned: number[] = [];
  let v = 0;
  for (const idx of order) {
    const demand = waypointDemand(requireIndex(points, idx, "waypoint"));
    if (options.capacity !== undefined && demand > options.capacity) {
      unassigned.push(idx);
      continue;
    }
    while (
      v < options.vehicleCount &&
      (requireIndex(stops, v, "vehicle").length >= target(v) || !fits(v, demand))
    ) {
      v += 1;
    }
    if (v < options.vehicleCount) {
      place(v, idx, demand);
    } else {
      overflow.push(idx);
    }
  }
  for (const idx of overflow) {
    const demand = waypointDemand(requireIndex(points, idx, "waypoint"));
    const slot = stops.findIndex((_, i) => fits(i, demand));
    if (slot === -1) {
      unassigned.push(idx);
    } else {
      place(slot, idx, demand);
    }
  }
  return {
    groups: stops.filter((s) => s.length > 0).map((s) => [options.startIndex, ...s]),
    unassigned: unassigned.sort((a, b) => a - b),
  };
}

function solveRoute(
  group: readonly number[],
  ctx: RouteContext,
  vehicleId: number,
  exactMaxSize: number,
  deadline: number,
): Route {
  const toGlobal = (local: readonly number[]): number[] =>
    local.map((i) => requireIndex(group, i, "group"));
  const distance: Distance = (i, j) =>
    ctx.legs.km(requireIndex(group, i, "group"), requireIndex(group, j, "group"));
  const hasWindows = group.some((i) => {
    const p = requireIndex(ctx.points, i, "waypoint");
    return p.readyTimeMin !== undefined || p.dueTimeMin !== undefined;
  });
  const scheduleEvaluate: Evaluate | undefined = hasWindows
    ? (local): Evaluation => {
        const schedule = simulate(toGlobal(local), ctx, false);
        return { distanceKm: schedule.distanceKm, latenessMin: schedule.latenessMin };
      }
    : undefined;
  const order = toGlobal(
    searchOrder(group.length, 0, distance, ctx.closed, scheduleEvaluate, exactMaxSize, deadline),
  );
  const schedule = simulate(order, ctx, true);
  const demand = order
    .slice(1)
    .reduce((sum, i) => sum + waypointDemand(requireIndex(ctx.points, i, "waypoint")), 0);
  return {
    vehicleId,
    stops: schedule.stops,
    distanceKm: schedule.distanceKm,
    durationMin: schedule.durationMin,
    demand,
    violations: schedule.violations,
  };
}

function validateInputs(
  points: readonly Waypoint[],
  matrices: CostMatrices,
  startIndex: number,
): void {
  if (points.length < 2) {
    throw new DomainError("EMPTY", "VRP requires at least two waypoints");
  }
  requireIndex(points, startIndex, "startIndex");
  const sizes = [matrices.distancesKm, matrices.durationsMin ?? matrices.distancesKm];
  if (
    sizes.some((m) => m.length !== points.length || m.some((row) => row.length !== points.length))
  ) {
    throw new DomainError(
      "MATRIX_SIZE",
      "cost matrix dimensions do not match the number of waypoints",
    );
  }
  points.forEach((p, i) => {
    if (
      p.readyTimeMin !== undefined &&
      p.dueTimeMin !== undefined &&
      p.readyTimeMin > p.dueTimeMin
    ) {
      throw new DomainError(
        "INVALID_TIME_WINDOW",
        `waypoint ${i} has readyTimeMin greater than dueTimeMin`,
      );
    }
  });
}

export function solveVrp(
  points: readonly Waypoint[],
  matrices: CostMatrices,
  options: VrpOptions,
): VrpResult {
  validateInputs(points, matrices, options.startIndex);
  const ctx: RouteContext = {
    points,
    legs: legCosts(matrices, options.averageSpeedKmh),
    closed: options.closed,
  };
  const { groups, unassigned } = assignVehicles(points, options);
  const exactMaxSize = options.exactMaxSize ?? DEFAULT_EXACT_MAX_SIZE;
  const end = performance.now() + (options.timeBudgetMs ?? DEFAULT_SEARCH_TIME_BUDGET_MS);
  const routes = groups.map((group, vehicleId) => {
    const now = performance.now();
    const share = Math.max(0, end - now) / (groups.length - vehicleId);
    return solveRoute(group, ctx, vehicleId, exactMaxSize, now + share);
  });
  return {
    routes,
    unassigned,
    totalDistanceKm: routes.reduce((sum, route) => sum + route.distanceKm, 0),
    totalDurationMin: routes.reduce((sum, route) => sum + route.durationMin, 0),
    feasible: unassigned.length === 0 && routes.every((route) => route.violations.length === 0),
  };
}

export function distanceMatrixFromCoords(coords: readonly Coord[]): number[][] {
  return coords.map((a) => coords.map((b) => haversineKm(a, b)));
}
