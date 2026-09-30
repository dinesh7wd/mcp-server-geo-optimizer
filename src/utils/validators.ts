import { DomainError } from "./errors.js";

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function requireIndex<T>(items: readonly T[], index: number, label: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new DomainError("OUT_OF_RANGE", `${label} index ${index} is out of range`);
  }
  return item;
}
