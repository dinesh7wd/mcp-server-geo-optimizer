export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function roundKm(value: number): number {
  return round(value, 3);
}

export function roundMin(value: number): number {
  return round(value, 2);
}

export function roundDeg(value: number): number {
  return round(value, 6);
}

export function roundMatrix(matrix: readonly (readonly number[])[], digits: number): number[][] {
  return matrix.map((row) => row.map((value) => round(value, digits)));
}
